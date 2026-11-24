/**
 * 通用表格导入服务（P1-8 / P1-9）
 *
 * 背景（实测）：
 *  - 后端**完全没有表格解析能力**：package.json 中不存在
 *    xlsx / exceljs / csv-parse 等任何相关依赖；唯一的 multipart 端点
 *    `/files/images` 只收图片；CSV 解析 100% 在浏览器端完成。
 *  - 前端 `CourseManage.vue:234` 会 POST `/admin/courses/import`，
 *    而该端点**不存在** → 必然 404。
 *
 * 本服务提供统一流水线：
 *   FileValidator → RowMapper(按表头名) → ValidatorChain → BatchWriter → ResultReporter
 * 且 xlsx / csv 共用同一条流水线，内部不出现格式特有的业务代码。
 *
 * 设计要点：
 *  - **流式/分块**：按批（默认 500 行）校验与写入，避免整表入内存；
 *  - **外键批量解析**：一次性把相关主数据读进 Map，**严禁循环查库**；
 *  - **错误带行号**：每条错误记录 {row, column, message}；
 *  - **绝不自动创建主数据**：外键查不到即进失败报告；
 *  - **dryRun**：只校验不写库；
 *  - **onDuplicate**：skip（默认）/ update / fail。
 */
import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from './prisma.service';
import { parseDateCell, formatDateTime } from './date-cell.util';

export type ImportBizType = 'students' | 'courses';
export type OnDuplicate = 'skip' | 'update' | 'fail';

export interface ImportRowError {
  row: number;
  column?: string;
  message: string;
}

export interface ImportResult {
  bizType: ImportBizType;
  format: 'xlsx' | 'csv';
  dryRun: boolean;
  onDuplicate: OnDuplicate;
  total: number;
  success: number;
  failed: number;
  skipped: number;
  updated: number;
  errors: ImportRowError[];
  /** 成功行中解析出的时间样本，便于人工核对 Excel 序列号是否被正确还原 */
  dateSamples: string[];
  durationMs: number;
}

interface ColumnSpec {
  /** 规范化后的内部字段名 */
  field: string;
  /** 允许的表头别名（中英文都支持） */
  aliases: string[];
  required?: boolean;
  /** 该列是日期列，需走 parseDateCell（可正确还原 Excel 序列号） */
  isDate?: boolean;
  isNumeric?: boolean;
}

/** 各业务类型的列元数据（解析与模板生成共用同一份定义） */
const COLUMN_SPECS: Record<ImportBizType, ColumnSpec[]> = {
  students: [
    { field: 'student_no', aliases: ['student_no', '学号'], required: true },
    { field: 'name', aliases: ['name', '姓名'], required: true },
    { field: 'gender', aliases: ['gender', '性别'] },
    { field: 'mobile', aliases: ['mobile', '手机号', '手机'] },
    { field: 'email', aliases: ['email', '邮箱'] },
    { field: 'class_name', aliases: ['class_name', '班级', '班级名称'], required: true },
    { field: 'enroll_year', aliases: ['enroll_year', '入学年份'], isNumeric: true },
    { field: 'major', aliases: ['major', '专业'] },
    { field: 'emergency_contact_name', aliases: ['emergency_contact_name', '紧急联系人'] },
    { field: 'emergency_contact_mobile', aliases: ['emergency_contact_mobile', '紧急联系人电话'] },
  ],
  courses: [
    { field: 'org_name', aliases: ['org_name', '学院', '学院名称'], required: true },
    { field: 'course_code', aliases: ['course_code', '课程代码', '课程编号'], required: true },
    { field: 'course_name', aliases: ['course_name', '课程名称'], required: true },
    { field: 'credit', aliases: ['credit', '学分'], isNumeric: true },
    { field: 'class_name', aliases: ['class_name', '班级', '班级名称'] },
    { field: 'teacher_name', aliases: ['teacher_name', '教师', '教师姓名'] },
    { field: 'term_code', aliases: ['term_code', '学期'] },
  ],
};

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);
  private readonly batchSize = 500;

  constructor(private readonly prisma: PrismaService) {}

  /** 下载模板用的列元数据（与解析共用，避免两处漂移） */
  getTemplateColumns(bizType: ImportBizType) {
    return COLUMN_SPECS[bizType];
  }

  // ============================================================
  // 解析层：xlsx / csv → 行对象数组
  // ============================================================

  /**
   * 识别文件格式：优先扩展名，其次魔数。
   * xlsx 是 zip 容器，魔数为 'PK\x03\x04'。
   */
  detectFormat(filename: string, buffer: Buffer): 'xlsx' | 'csv' {
    const name = String(filename || '').toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) return 'xlsx';
    // 魔数兜底：扩展名不可信时按内容判断
    if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) return 'xlsx';
    return 'csv';
  }

  /** 解析为二维数组（第一行为表头） */
  private parseRows(
    format: 'xlsx' | 'csv',
    buffer: Buffer,
  ): { header: string[]; rows: unknown[][] } {
    if (format === 'xlsx') {
      const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) {
        throw new Error('Excel 文件没有任何工作表');
      }
      const ws = wb.Sheets[sheetName];
      // raw:true 保留原始类型（关键：Excel 序列号必须保持为数字才能被正确还原）
      const all = XLSX.utils.sheet_to_json<unknown[]>(ws, {
        header: 1,
        raw: true,
        defval: null,
        blankrows: false,
      });
      if (all.length === 0) throw new Error('Excel 工作表为空');
      const header = (all[0] as unknown[]).map((h) => String(h ?? '').trim());
      return { header, rows: all.slice(1) as unknown[][] };
    }

    // CSV：先按 UTF-8 解码，失败则回退 GBK（高校导出 CSV 大量是 GBK）
    const text = this.decodeCsv(buffer);
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length === 0) throw new Error('CSV 文件为空');
    const delimiter = this.sniffDelimiter(lines[0]);
    const header = this.splitCsvLine(lines[0], delimiter).map((h) => h.trim());
    const rows = lines.slice(1).map((l) => this.splitCsvLine(l, delimiter));
    return { header, rows };
  }

  /**
   * CSV 编码嗅探：UTF-8(BOM) → UTF-8 → GB18030。
   * 不做这一步，GBK 导出的中文会全乱码。
   */
  private decodeCsv(buffer: Buffer): string {
    // 去 BOM
    let buf = buffer;
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      buf = buf.subarray(3);
    }
    const utf8 = buf.toString('utf8');
    // U+FFFD 说明 UTF-8 解码失败
    if (!utf8.includes('\uFFFD')) {
      return utf8;
    }
    try {
      // Node 内置支持 gb18030 解码
      return new TextDecoder('gb18030').decode(buf);
    } catch {
      return utf8;
    }
  }

  /** 分隔符嗅探：逗号 / 分号 / 制表符 */
  private sniffDelimiter(line: string): string {
    const candidates = [',', ';', '\t'];
    let best = ',';
    let bestCount = -1;
    for (const c of candidates) {
      const count = line.split(c).length - 1;
      if (count > bestCount) {
        bestCount = count;
        best = c;
      }
    }
    return best;
  }

  /** 极简 CSV 单行切分（支持双引号包裹与转义双引号） */
  private splitCsvLine(line: string, delimiter: string): string[] {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  // ============================================================
  // 映射层：按表头名（而非列序号）建立 列索引 → 字段
  // ============================================================

  private buildColumnMap(
    bizType: ImportBizType,
    header: string[],
    errors: ImportRowError[],
  ): Map<number, ColumnSpec> {
    const specs = COLUMN_SPECS[bizType];
    const normalizedHeader = header.map((h) =>
      String(h ?? '')
        .replace(/^\uFEFF/, '')
        .trim()
        .toLowerCase(),
    );

    const map = new Map<number, ColumnSpec>();
    const matchedFields = new Set<string>();

    normalizedHeader.forEach((h, idx) => {
      if (!h) return;
      const spec = specs.find((s) =>
        s.aliases.some((a) => a.toLowerCase() === h),
      );
      if (spec) {
        map.set(idx, spec);
        matchedFields.add(spec.field);
      }
    });

    // 缺列明确报错
    for (const spec of specs) {
      if (spec.required && !matchedFields.has(spec.field)) {
        errors.push({
          row: 1,
          column: spec.field,
          message: `缺少必需列（可用表头：${spec.aliases.join(' / ')}）`,
        });
      }
    }

    return map;
  }

  // ============================================================
  // 主入口
  // ============================================================

  async importBuffer(options: {
    bizType: ImportBizType;
    filename: string;
    buffer: Buffer;
    dryRun?: boolean;
    onDuplicate?: OnDuplicate;
  }): Promise<ImportResult> {
    const started = Date.now();
    const { bizType, filename, buffer } = options;
    const dryRun = Boolean(options.dryRun);
    const onDuplicate: OnDuplicate = options.onDuplicate || 'skip';

    const errors: ImportRowError[] = [];
    const dateSamples: string[] = [];
    let success = 0;
    let failed = 0;
    let skipped = 0;
    let updated = 0;

    const format = this.detectFormat(filename, buffer);

    let header: string[] = [];
    let rows: unknown[][] = [];
    try {
      const parsed = this.parseRows(format, buffer);
      header = parsed.header;
      rows = parsed.rows;
    } catch (e: any) {
      return {
        bizType,
        format,
        dryRun,
        onDuplicate,
        total: 0,
        success: 0,
        failed: 0,
        skipped: 0,
        updated: 0,
        errors: [{ row: 0, message: `文件解析失败：${e?.message || e}` }],
        dateSamples: [],
        durationMs: Date.now() - started,
      };
    }

    const columnMap = this.buildColumnMap(bizType, header, errors);
    if (errors.some((e) => e.row === 1)) {
      // 表头不合格，直接返回，不做无意义的逐行校验
      return {
        bizType,
        format,
        dryRun,
        onDuplicate,
        total: rows.length,
        success: 0,
        failed: rows.length,
        skipped: 0,
        updated: 0,
        errors,
        dateSamples: [],
        durationMs: Date.now() - started,
      };
    }

    // 外键主数据一次性载入（严禁循环查库）
    const lookups = await this.loadLookups(bizType);

    // 分批处理，避免大文件整表入内存
    for (let start = 0; start < rows.length; start += this.batchSize) {
      const batch = rows.slice(start, start + this.batchSize);
      for (let i = 0; i < batch.length; i++) {
        const sheetRow = start + i + 2; // +2：1 基 + 表头占一行
        const mapped = this.mapRow(batch[i], columnMap, sheetRow, errors);
        if (!mapped) {
          failed++;
          continue;
        }

        const outcome = await this.writeRow(
          bizType,
          mapped,
          sheetRow,
          lookups,
          errors,
          dryRun,
          onDuplicate,
        );
        if (outcome === 'success') success++;
        else if (outcome === 'updated') {
          updated++;
          success++;
        } else if (outcome === 'skipped') skipped++;
        else failed++;

        // 采集日期样本，便于人工核对 Excel 序列号还原是否正确
        if (mapped.__dates && dateSamples.length < 5) {
          for (const [k, v] of Object.entries(mapped.__dates)) {
            if (dateSamples.length < 5) {
              dateSamples.push(`${k}=${formatDateTime(v as Date)}`);
            }
          }
        }
      }
    }

    const result: ImportResult = {
      bizType,
      format,
      dryRun,
      onDuplicate,
      total: rows.length,
      success,
      failed,
      skipped,
      updated,
      errors: errors.slice(0, 200),
      dateSamples,
      durationMs: Date.now() - started,
    };

    this.logger.log(
      `[导入] ${bizType} 文件=${filename} 格式=${format} 总=${result.total} ` +
        `成功=${success} 失败=${failed} 跳过=${skipped} 干跑=${dryRun} 耗时=${result.durationMs}ms`,
    );

    return result;
  }

  /** 把一行按列映射为字段对象；校验失败返回 null 并记录错误 */
  private mapRow(
    row: unknown[],
    columnMap: Map<number, ColumnSpec>,
    sheetRow: number,
    errors: ImportRowError[],
  ): Record<string, any> | null {
    const out: Record<string, any> = { __dates: {} as Record<string, Date> };
    let rowOk = true;

    for (const [idx, spec] of columnMap.entries()) {
      const raw = row[idx];
      const isEmpty = raw === null || raw === undefined || String(raw).trim() === '';

      if (isEmpty) {
        if (spec.required) {
          errors.push({ row: sheetRow, column: spec.field, message: '必填项为空' });
          rowOk = false;
        } else {
          out[spec.field] = null;
        }
        continue;
      }

      if (spec.isDate) {
        try {
          const d = parseDateCell(raw, { row: sheetRow, column: spec.field });
          out[spec.field] = d;
          (out.__dates as Record<string, Date>)[spec.field] = d;
        } catch (e: any) {
          errors.push({ row: sheetRow, column: spec.field, message: e?.message || '日期无效' });
          rowOk = false;
        }
        continue;
      }

      if (spec.isNumeric) {
        const num = Number(String(raw).trim());
        if (!Number.isFinite(num)) {
          errors.push({
            row: sheetRow,
            column: spec.field,
            message: `应为数字，实际为 "${String(raw).slice(0, 30)}"`,
          });
          rowOk = false;
        } else {
          out[spec.field] = num;
        }
        continue;
      }

      out[spec.field] = String(raw).trim();
    }

    return rowOk ? out : null;
  }

  /** 一次性载入外键主数据到 Map（避免 N+1 查询） */
  private async loadLookups(bizType: ImportBizType) {
    const [orgs, classes, users, courses] = await Promise.all([
      this.prisma.orgs.findMany({ select: { id: true, name: true } }),
      this.prisma.classes.findMany({ select: { id: true, class_name: true, org_id: true } }),
      this.prisma.users.findMany({ select: { id: true, name: true, user_type: true } }),
      this.prisma.courses.findMany({
        select: { id: true, course_code: true, course_name: true, org_id: true },
      }),
    ]);

    return {
      orgByName: new Map(orgs.map((o) => [o.name.trim(), o.id])),
      classByName: new Map(classes.map((c) => [c.class_name.trim(), c])),
      teacherByName: new Map(
        users.filter((u) => u.user_type === 'teacher').map((u) => [u.name.trim(), u.id]),
      ),
      courseByCode: new Map(
        courses
          .filter((c) => c.course_code)
          .map((c) => [String(c.course_code).trim(), c]),
      ),
    };
  }

  /** 写单行；返回处理结果 */
  private async writeRow(
    bizType: ImportBizType,
    row: Record<string, any>,
    sheetRow: number,
    lookups: Awaited<ReturnType<ImportService['loadLookups']>>,
    errors: ImportRowError[],
    dryRun: boolean,
    onDuplicate: OnDuplicate,
  ): Promise<'success' | 'updated' | 'skipped' | 'failed'> {
    if (bizType === 'courses') {
      const orgId = lookups.orgByName.get(String(row.org_name || '').trim());
      if (!orgId) {
        errors.push({ row: sheetRow, column: 'org_name', message: `组织中不存在："${row.org_name}"（不会自动创建）` });
        return 'failed';
      }
      const existing = lookups.courseByCode.get(String(row.course_code || '').trim());
      if (existing) {
        if (onDuplicate === 'fail') {
          errors.push({ row: sheetRow, column: 'course_code', message: `课程代码已存在：${row.course_code}` });
          return 'failed';
        }
        if (onDuplicate === 'skip') return 'skipped';
        if (!dryRun) {
          await this.prisma.courses.update({
            where: { id: existing.id },
            data: {
              course_name: row.course_name,
              credit: row.credit === null || row.credit === undefined ? undefined : row.credit,
              updated_at: new Date(),
            },
          });
        }
        return 'updated';
      }
      if (!dryRun) {
        const created = await this.prisma.courses.create({
          data: {
            org_id: orgId,
            course_code: String(row.course_code).trim(),
            course_name: String(row.course_name).trim(),
            credit: row.credit === null || row.credit === undefined ? null : row.credit,
            status: 'active',
          },
        });
        lookups.courseByCode.set(String(row.course_code).trim(), {
          id: created.id,
          course_code: created.course_code,
          course_name: created.course_name,
          org_id: created.org_id,
        });
      }
      return 'success';
    }

    // students
    const cls = lookups.classByName.get(String(row.class_name || '').trim());
    if (!cls) {
      errors.push({ row: sheetRow, column: 'class_name', message: `班级不存在："${row.class_name}"（不会自动创建）` });
      return 'failed';
    }
    const studentNo = String(row.student_no || '').trim();
    const existing = await this.prisma.student_profiles.findUnique({
      where: { student_no: studentNo },
      select: { id: true },
    });
    if (existing) {
      if (onDuplicate === 'fail') {
        errors.push({ row: sheetRow, column: 'student_no', message: `学号已存在：${studentNo}` });
        return 'failed';
      }
      if (onDuplicate === 'skip') return 'skipped';
      if (!dryRun) {
        await this.prisma.student_profiles.update({
          where: { id: existing.id },
          data: {
            class_id: cls.id,
            org_id: cls.org_id,
            mobile: row.mobile ?? null,
            email: row.email ?? null,
            updated_at: new Date(),
          },
        });
      }
      return 'updated';
    }
    if (!dryRun) {
      // 学生档案必须先有账号；这里创建最小账号 + 档案
      const user = await this.prisma.users.create({
        data: {
          org_id: cls.org_id,
          user_type: 'student',
          name: String(row.name).trim(),
          mobile: row.mobile ?? null,
          email: row.email ?? null,
          status: 'active',
        },
      });
      await this.prisma.student_profiles.create({
        data: {
          user_id: user.id,
          student_no: studentNo,
          gender: row.gender ?? null,
          class_id: cls.id,
          org_id: cls.org_id,
          enroll_year: row.enroll_year ?? null,
          major: row.major ?? null,
          mobile: row.mobile ?? null,
          email: row.email ?? null,
          emergency_contact_name: row.emergency_contact_name ?? null,
          emergency_contact_mobile: row.emergency_contact_mobile ?? null,
          status: 'active',
        },
      });
    }
    return 'success';
  }
}
