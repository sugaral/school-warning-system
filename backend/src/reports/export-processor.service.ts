/**
 * 报表导出：真实异步链路（P1-7 修复）
 *
 * 修复前实测状态（"伪异步"）：
 *  - `reports.controller.ts` 的 `createExportJob` 在**生成报表的同一个请求里**
 *    直接 `status: 'completed'` 落库；
 *  - 从不出现 `queued` / `running` 中间态，**没有任何 worker 消费**；
 *  - `file_id` 与 `error_msg` 两个字段**从不被写入**；
 *  - 结论：`export_jobs` 只是元数据表，不是任务队列；大报表会阻塞请求，
 *    且前端无法展示进度、卡死时也无从排查。
 *
 * 修复后链路：
 *   创建 job(status='queued') → worker 领取(status='running')
 *   → 生成 xlsx → 上传 MinIO → 写 files(source='export')
 *   → 回填 export_jobs.file_id + status='completed'
 *   失败则写 error_msg + status='failed'
 *
 * 状态口径（统一）：
 *   历史数据与前端都以 'completed' 作为"已完成"；
 *   之前这里写的是 'success'，导致前端只认 'completed' 时永远显示"生成中"、
 *   下载按钮不出现（文件其实已经生成）。下载端同时兼容旧的 'success'。
 *
 * 并发：
 *  - 用条件更新（CAS）领取任务，避免多副本重复处理；
 *  - 每批限制条数，单条失败不影响整批。
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHash } from 'crypto';
import * as XLSX from 'xlsx';
import { PrismaService } from '../shared/prisma.service';
import { MinioService } from '../shared/minio.service';
import { RedisService } from '../shared/redis.service';

export type ReportType =
  | 'daily'
  | 'weekly'
  | 'monthly'
  // 控制器侧使用 'semester'，处理侧统一按学期汇总处理（两者是同一语义）
  | 'semester'
  | 'term'
  | 'warning_list'
  | 'notify_success';

/** 单次导出最大行数：超过则分批查询，避免一次性把 10 万行读进内存 */
const EXPORT_PAGE_SIZE = 2000;
/** 单文件硬上限，防止误操作导出整库 */
const EXPORT_MAX_ROWS = 200_000;

interface ExportRow {
  [key: string]: string | number | null;
}

@Injectable()
export class ExportProcessorService {
  private readonly logger = new Logger(ExportProcessorService.name);
  private readonly lockKey = 'lock:export:process';
  private readonly lockTtlMs = 5 * 60 * 1000;
  private processing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
    private readonly redis: RedisService,
  ) {}

  // ============================================================
  // 入队
  // ============================================================

  /** 创建导出任务（只入队，不同步生成） */
  async enqueue(input: {
    creatorUserId: bigint;
    reportType: ReportType;
    params: Record<string, any>;
    scopeType: string;
    scopeId: bigint | null;
  }) {
    const job = await this.prisma.export_jobs.create({
      data: {
        creator_user_id: input.creatorUserId,
        scope_type: input.scopeType,
        scope_id: input.scopeId,
        report_type: input.reportType,
        params_json: input.params as any,
        // 关键：入队即 queued，**不再直接写 completed**
        status: 'queued',
        updated_at: new Date(),
      },
    });

    this.logger.log(
      `[导出] 任务已入队 id=${job.id.toString()} type=${input.reportType} scope=${input.scopeType}`,
    );
    return job;
  }

  // ============================================================
  // Worker
  // ============================================================

  /** 每 20 秒扫描一次待处理导出任务（worker 容器执行） */
  @Cron('*/20 * * * * *', { timeZone: 'Asia/Shanghai' })
  async processQueuedExports() {
    if (this.processing) return;

    this.processing = true;
    let lockToken: string | null = null;
    try {
      // 分布式锁：多副本下只有一个实例在消费
      lockToken = `${process.pid}:${Date.now()}`;
      let locked = false;
      try {
        locked = await this.redis.acquireLock(this.lockKey, this.lockTtlMs, lockToken);
      } catch {
        locked = true;
        lockToken = null;
      }
      if (!locked) return;

      const jobs = await this.prisma.export_jobs.findMany({
        where: { status: 'queued' },
        orderBy: { created_at: 'asc' },
        take: 5,
      });
      if (jobs.length === 0) return;

      for (const job of jobs) {
        await this.processOne(job);
      }
    } catch (error: any) {
      this.logger.error(`[导出] 扫描任务失败：${error?.message || error}`);
    } finally {
      this.processing = false;
      if (lockToken) {
        await this.redis.releaseLock(this.lockKey, lockToken).catch(() => undefined);
      }
    }
  }

  /** 处理单个任务；CAS 领取避免重复 */
  async processOne(job: any) {
    const jobId = job.id as bigint;
    const startedAt = Date.now();

    // CAS：只有仍处于 queued 时才由本实例接管
    const claimed = await this.prisma.export_jobs.updateMany({
      where: { id: jobId, status: 'queued' },
      data: { status: 'running', updated_at: new Date(), error_msg: null },
    });
    if (claimed.count === 0) {
      return; // 已被其他实例领取
    }

    try {
      const { rows, columns, title } = await this.buildDataset(job);
      const buffer = this.toXlsxBuffer(rows, columns, title);

      // 上传 MinIO
      const objectKey = this.buildObjectKey(job);
      await this.minio.putBuffer({
        bucket: this.minio.getUploadBucket(),
        key: objectKey,
        body: buffer,
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      // 写 files（source='export'）并回填 file_id
      const sha256 = createHash('sha256').update(buffer).digest('hex');
      const fileRow = await this.prisma.files.create({
        data: {
          uploader_user_id: job.creator_user_id,
          file_name: `${title}.xlsx`,
          file_key: objectKey,
          file_size: BigInt(buffer.length),
          mime_type:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          sha256,
          source: 'export',
        },
      });

      await this.prisma.export_jobs.update({
        where: { id: jobId },
        data: {
          status: 'completed',
          file_id: fileRow.id,
          error_msg: null,
          updated_at: new Date(),
        },
      });

      this.logger.log(
        `[导出] 任务完成 id=${jobId.toString()} 行数=${rows.length} ` +
          `字节=${buffer.length} 耗时=${Date.now() - startedAt}ms file_id=${fileRow.id.toString()}`,
      );
      return { success: true, rows: rows.length };
    } catch (error: any) {
      const message = String(error?.message || error).slice(0, 255);
      await this.prisma.export_jobs.update({
        where: { id: jobId },
        data: {
          status: 'failed',
          error_msg: message,
          updated_at: new Date(),
        },
      });
      this.logger.error(`[导出] 任务失败 id=${jobId.toString()}：${message}`);
      return { success: false, error: message };
    }
  }

  // ============================================================
  // 数据集构建
  // ============================================================

  /** 依据 report_type 构建导出数据集（分页查询，避免一次性载入） */
  private async buildDataset(job: any): Promise<{
    rows: ExportRow[];
    columns: string[];
    title: string;
  }> {
    const type = String(job.report_type) as ReportType;
    const params = (job.params_json as Record<string, any>) || {};

    switch (type) {
      case 'warning_list':
        return this.buildWarningList(job, params);
      case 'notify_success':
        return this.buildNotifySuccess(job, params);
      // 'semester' 与 'term' 是同一语义（控制器用前者，规范用后者），都必须支持，
      // 否则学期导出会以「不支持的 report_type」直接失败（实测踩到过）。
      case 'daily':
      case 'weekly':
      case 'monthly':
      case 'semester':
      case 'term':
        return this.buildSummaryReport(type, job, params);
      default:
        throw new Error(`不支持的 report_type：${type}`);
    }
  }

  /** 预警清单导出（含数据范围限制） */
  private async buildWarningList(job: any, params: Record<string, any>) {
    const where: any = {};
    if (params.level) where.level = String(params.level);
    if (params.window) where.window = String(params.window);
    if (params.metric) where.metric = String(params.metric);
    if (params.status) where.status = String(params.status);

    // 数据范围：非全校范围时收敛到对应 org / class / student
    this.applyScopeFilter(where, job);

    const rows: ExportRow[] = [];
    let cursor: bigint | null = null;

    // 分页拉取，避免一次性载入
    for (let page = 0; page < Math.ceil(EXPORT_MAX_ROWS / EXPORT_PAGE_SIZE); page++) {
      const batch: Array<{ id: bigint } & Record<string, any>> =
        await this.prisma.warnings.findMany({
          where: { ...where, ...(cursor ? { id: { gt: cursor } } : {}) },
          orderBy: { id: 'asc' },
          take: EXPORT_PAGE_SIZE,
          select: {
            id: true,
            student_id: true,
            class_id: true,
            org_id: true,
            metric: true,
            level: true,
            window: true,
            period_start: true,
            period_end: true,
            trigger_summary: true,
            status: true,
            created_at: true,
            acknowledged_at: true,
            closed_at: true,
            close_note: true,
          },
        });
      if (batch.length === 0) break;

      for (const w of batch) {
        rows.push({
          预警ID: w.id.toString(),
          学生ID: w.student_id.toString(),
          班级ID: w.class_id?.toString() ?? '',
          组织ID: w.org_id?.toString() ?? '',
          指标: w.metric,
          等级: w.level,
          窗口: w.window,
          周期开始: this.fmtDate(w.period_start),
          周期结束: this.fmtDate(w.period_end),
          触发摘要: w.trigger_summary ?? '',
          状态: w.status,
          触发时间: this.fmtDateTime(w.created_at),
          确认时间: w.acknowledged_at ? this.fmtDateTime(w.acknowledged_at) : '',
          关闭时间: w.closed_at ? this.fmtDateTime(w.closed_at) : '',
          关闭说明: w.close_note ?? '',
        });
      }
      cursor = batch[batch.length - 1].id;
      if (batch.length < EXPORT_PAGE_SIZE) break;
    }

    return {
      rows,
      columns: [
        '预警ID', '学生ID', '班级ID', '组织ID', '指标', '等级', '窗口',
        '周期开始', '周期结束', '触发摘要', '状态', '触发时间',
        '确认时间', '关闭时间', '关闭说明',
      ],
      title: '预警清单',
    };
  }

  /** 通知送达情况导出（按 receiver 一行） */
  private async buildNotifySuccess(job: any, params: Record<string, any>) {
    const where: any = {};
    if (params.send_status) where.send_status = String(params.send_status);
    if (params.channel) where.channel = String(params.channel);

    const rows: ExportRow[] = [];
    let cursor: bigint | null = null;

    for (let page = 0; page < Math.ceil(EXPORT_MAX_ROWS / EXPORT_PAGE_SIZE); page++) {
      const batch: Array<{ id: bigint } & Record<string, any>> =
        await this.prisma.notification_logs.findMany({
          where: { ...where, ...(cursor ? { id: { gt: cursor } } : {}) },
          orderBy: { id: 'asc' },
          take: EXPORT_PAGE_SIZE,
          select: {
            id: true,
            job_id: true,
            channel: true,
            receiver: true,
            send_status: true,
            provider: true,
            provider_msg_id: true,
            error_msg: true,
            sent_at: true,
            acknowledged: true,
            acknowledged_at: true,
          },
        });
      if (batch.length === 0) break;

      for (const l of batch) {
        rows.push({
          日志ID: l.id.toString(),
          任务ID: l.job_id.toString(),
          渠道: l.channel,
          接收人: l.receiver,
          发送状态: l.send_status,
          服务商: l.provider ?? '',
          服务商回执ID: l.provider_msg_id ?? '',
          错误信息: l.error_msg ?? '',
          发送时间: this.fmtDateTime(l.sent_at),
          已确认: l.acknowledged ? '是' : '否',
          确认时间: l.acknowledged_at ? this.fmtDateTime(l.acknowledged_at) : '',
        });
      }
      cursor = batch[batch.length - 1].id;
      if (batch.length < EXPORT_PAGE_SIZE) break;
    }

    return {
      rows,
      columns: [
        '日志ID', '任务ID', '渠道', '接收人', '发送状态', '服务商',
        '服务商回执ID', '错误信息', '发送时间', '已确认', '确认时间',
      ],
      title: '通知送达情况',
    };
  }

  /** 汇总类报表：直接读三张汇总表（P1-5 落地后已具备数据源） */
  private async buildSummaryReport(
    type: ReportType,
    job: any,
    params: Record<string, any>,
  ) {
    const scopeStudentIds = await this.resolveScopeStudentIds(job);

    if (type === 'semester' || type === 'term') {
      const termCode = params.term_code ? String(params.term_code) : undefined;
      const list = await this.prisma.term_summaries.findMany({
        where: {
          ...(termCode ? { term_code: termCode } : {}),
          ...(scopeStudentIds ? { student_id: { in: scopeStudentIds } } : {}),
        },
        orderBy: [{ term_code: 'desc' }, { student_id: 'asc' }],
        take: EXPORT_MAX_ROWS,
      });
      return {
        rows: list.map((t) => ({
          学生ID: t.student_id.toString(),
          学期: t.term_code,
          挂科门数: t.failed_course_count,
          已修学分: t.earned_credits.toString(),
          要求学分: t.required_credits.toString(),
          GPA: t.gpa === null ? '' : t.gpa.toString(),
          生成时间: this.fmtDateTime(t.generated_at),
        })),
        columns: ['学生ID', '学期', '挂科门数', '已修学分', '要求学分', 'GPA', '生成时间'],
        title: '学期汇总',
      };
    }

    if (type === 'monthly') {
      const year = Number(params.year) || new Date().getFullYear();
      const month = Number(params.month) || new Date().getMonth() + 1;
      const list = await this.prisma.monthly_summaries.findMany({
        where: {
          year,
          month,
          ...(scopeStudentIds ? { student_id: { in: scopeStudentIds } } : {}),
        },
        orderBy: { student_id: 'asc' },
        take: EXPORT_MAX_ROWS,
      });
      return {
        rows: list.map((m) => ({
          学生ID: m.student_id.toString(),
          年: m.year,
          月: m.month,
          迟到次数: m.late_count,
          缺勤次数: m.absent_count,
          作业未交次数: m.homework_not_submit_count,
          生成时间: this.fmtDateTime(m.generated_at),
        })),
        columns: ['学生ID', '年', '月', '迟到次数', '缺勤次数', '作业未交次数', '生成时间'],
        title: '月度汇总',
      };
    }

    // daily / weekly 均读周汇总（daily 粒度另以 daily_records 聚合）
    if (type === 'daily') {
      const date = params.date ? String(params.date) : this.fmtDate(new Date());
      const dayStart = new Date(`${date}T00:00:00`);
      const dayEnd = new Date(`${date}T23:59:59.999`);
      const list = await this.prisma.daily_records.findMany({
        where: {
          record_date: { gte: dayStart, lte: dayEnd },
          ...(scopeStudentIds ? { student_id: { in: scopeStudentIds } } : {}),
        },
        orderBy: [{ student_id: 'asc' }],
        take: EXPORT_MAX_ROWS,
      });
      return {
        rows: list.map((d) => ({
          学生ID: d.student_id.toString(),
          日期: this.fmtDate(d.record_date),
          班级ID: d.class_id.toString(),
          课程ID: d.course_id?.toString() ?? '',
          考勤状态: d.attendance_status,
          作业状态: d.homework_status,
          课堂表现: d.class_behavior ?? '',
          备注: d.remarks ?? '',
        })),
        columns: ['学生ID', '日期', '班级ID', '课程ID', '考勤状态', '作业状态', '课堂表现', '备注'],
        title: `日记录_${date}`,
      };
    }

    // weekly
    const list = await this.prisma.weekly_summaries.findMany({
      where: { ...(scopeStudentIds ? { student_id: { in: scopeStudentIds } } : {}) },
      orderBy: [{ week_start: 'desc' }, { student_id: 'asc' }],
      take: EXPORT_MAX_ROWS,
    });
    return {
      rows: list.map((w) => ({
        学生ID: w.student_id.toString(),
        周开始: this.fmtDate(w.week_start),
        周结束: this.fmtDate(w.week_end),
        迟到次数: w.late_count,
        缺勤次数: w.absent_count,
        作业未交次数: w.homework_not_submit_count,
        生成时间: this.fmtDateTime(w.generated_at),
      })),
      columns: ['学生ID', '周开始', '周结束', '迟到次数', '缺勤次数', '作业未交次数', '生成时间'],
      title: '周汇总',
    };
  }

  // ============================================================
  // 数据范围
  // ============================================================

  /** 把 job 的 scope 收敛为 warnings 查询条件 */
  private applyScopeFilter(where: any, job: any) {
    const scopeType = String(job.scope_type || 'school');
    const scopeId = job.scope_id as bigint | null;
    if (scopeType === 'org' && scopeId !== null) where.org_id = scopeId;
    else if (scopeType === 'class' && scopeId !== null) where.class_id = scopeId;
    else if (scopeType === 'self' && scopeId !== null) where.student_id = scopeId;
    // school / system / mixed → 不加限制（调用方已校验权限）
  }

  /** 解析可见学生 id 列表；返回 null 表示不限制 */
  private async resolveScopeStudentIds(job: any): Promise<bigint[] | null> {
    const scopeType = String(job.scope_type || 'school');
    const scopeId = job.scope_id as bigint | null;

    if (scopeType === 'self' && scopeId !== null) return [scopeId];
    if (scopeType === 'class' && scopeId !== null) {
      const list = await this.prisma.student_profiles.findMany({
        where: { class_id: scopeId },
        select: { id: true },
      });
      return list.map((s) => s.id);
    }
    if (scopeType === 'org' && scopeId !== null) {
      const list = await this.prisma.student_profiles.findMany({
        where: { org_id: scopeId },
        select: { id: true },
      });
      return list.map((s) => s.id);
    }
    return null;
  }

  // ============================================================
  // 工具
  // ============================================================

  /** 生成 xlsx Buffer（表头 + 数据，首行冻结） */
  private toXlsxBuffer(rows: ExportRow[], columns: string[], title: string): Buffer {
    const aoa: (string | number | null)[][] = [columns];
    for (const r of rows) {
      aoa.push(columns.map((c) => r[c] ?? ''));
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // 首行冻结，便于翻阅大表
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    const wb = XLSX.utils.book_new();
    // sheet 名不能超过 31 字符，也不能含 : \ / ? * [ ]
    XLSX.utils.book_append_sheet(wb, ws, this.safeSheetName(title));
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  private safeSheetName(name: string): string {
    return String(name || 'Sheet1').replace(/[:\\/?*[\]]/g, '_').slice(0, 31);
  }

  private buildObjectKey(job: any): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `exports/${y}${m}/${d}/export_${job.id.toString()}_${Date.now()}.xlsx`;
  }

  private fmtDate(d: Date | null | undefined): string {
    if (!d) return '';
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return '';
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(
      dt.getDate(),
    ).padStart(2, '0')}`;
  }

  private fmtDateTime(d: Date | null | undefined): string {
    if (!d) return '';
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ` +
      `${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`
    );
  }
}
