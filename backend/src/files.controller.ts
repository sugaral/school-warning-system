import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHash, randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { extname, join } from 'path';
import { PinoLogger } from 'nestjs-pino';
import { AuthGuard } from './shared/auth.guard';
import { PermissionGuard } from './rbac/permission.guard';
import { Permissions } from './rbac/permission.decorator';
import { serializeFileRecord } from './shared/file.util';
import { canAccessFileRecord as canAccessFileRecordByRule } from './shared/file-access.util';
import { MinioService } from './shared/minio.service';
import { PrismaService } from './shared/prisma.service';
import {
  getPrimaryUploadRoot,
  getUploadRootCandidates,
  resolveExistingUploadFilePath,
} from './shared/upload-path.util';

type UploadedImageFile = {
  mimetype: string;
  originalname?: string;
  size?: number;
  buffer: Buffer;
};

class UploadImageDto {
  source?: string;
}

@Controller()
@UseGuards(AuthGuard, PermissionGuard)
export class FilesController {
  private readonly allowedMimeTypes = new Map<string, string>([
    ['image/jpeg', '.jpg'],
    ['image/png', '.png'],
    ['image/webp', '.webp'],
    ['image/gif', '.gif'],
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
    private readonly minioService: MinioService,
  ) {
    this.logger.setContext('FilesController');
  }

  private getUserId(req: any) {
    const raw = req.user?.sub ?? req.user?.userId;
    const normalized = String(raw || '').trim();
    if (!/^\d+$/.test(normalized)) {
      throw new BadRequestException('用户信息无效');
    }
    return BigInt(normalized);
  }

  private normalizeSource(value: unknown) {
    const normalized = String(value || 'upload')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 32);

    return normalized || 'upload';
  }

  private getUploadRoot() {
    return getPrimaryUploadRoot(process.cwd());
  }

  private serializeRecord(record: any, preferAdminUrl = false) {
    const payload = serializeFileRecord(record);
    if (!payload) {
      return null;
    }

    if (!preferAdminUrl) {
      return payload;
    }

    return {
      ...payload,
      url: `/admin/files/${record.id.toString()}/download`,
    };
  }

  private parseFileId(id: string) {
    const normalized = String(id || '').trim();
    if (!/^\d+$/.test(normalized)) {
      throw new BadRequestException('文件 ID 无效');
    }
    return BigInt(normalized);
  }

  private async getFileRecord(fileId: bigint) {
    return this.prisma.files.findUnique({
      where: { id: fileId },
    });
  }

  /**
   * 文件归属校验。
   *
   * 原实现的 GET /files/:id 没有任何权限码，GET /files/:id/download 只校验
   * `file:download`，两者都不校验归属 —— 只要 id 是数字就能遍历读取别人的
   * 证件照、请假凭证、申诉证据。判定规则抽到 file-access.util 里，便于单测。
   */
  private canAccessFileRecord(req: any, record: any) {
    return canAccessFileRecordByRule(
      {
        userId: req?.user?.sub ?? req?.user?.userId,
        userType: req?.user?.user_type ?? req?.user?.userType,
      },
      record,
    );
  }

  @Post(['files/images', 'admin/files/images'])
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 5 * 1024 * 1024,
      },
    }),
  )
  async uploadImage(
    @UploadedFile() file: UploadedImageFile | undefined,
    @Body() dto: UploadImageDto,
    @Req() req: any,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('请先选择图片');
    }

    const fallbackExt = this.allowedMimeTypes.get(file.mimetype);
    if (!fallbackExt) {
      throw new BadRequestException('仅支持 JPG、PNG、WEBP、GIF 图片');
    }

    const source = this.normalizeSource(dto.source);
    const originalExt = extname(file.originalname || '').toLowerCase();
    const extension = originalExt || fallbackExt;
    const date = new Date();
    const relativeSegments = [
      'images',
      String(date.getFullYear()),
      String(date.getMonth() + 1).padStart(2, '0'),
    ];
    const relativeFileKey = [
      ...relativeSegments,
      `${date.getTime()}-${randomBytes(8).toString('hex')}${extension}`,
    ].join('/');

    if (this.minioService.isConfigured()) {
      await this.minioService.putBuffer({
        bucket: this.minioService.getUploadBucket(),
        key: relativeFileKey,
        body: file.buffer,
        contentType: file.mimetype,
        metadata: {
          'x-amz-meta-source': source,
        },
      });
    } else {
      const uploadRoot = this.getUploadRoot();
      const absolutePath = join(uploadRoot, relativeFileKey);
      await fs.mkdir(join(uploadRoot, ...relativeSegments), { recursive: true });
      await fs.writeFile(absolutePath, file.buffer);
    }

    const record = await this.prisma.files.create({
      data: {
        uploader_user_id: this.getUserId(req),
        file_name: String(file.originalname || `image${extension}`).slice(0, 256),
        file_key: relativeFileKey,
        file_size: BigInt(file.size || file.buffer.length || 0),
        mime_type: file.mimetype,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
        source,
      },
    });

    return {
      code: 0,
      message: '图片上传成功',
      data: this.serializeRecord(record, true),
      trace_id: req.trace_id,
    };
  }

  @Get(['files/:id/download', 'admin/files/:id/download'])
  @Permissions('file:download')
  async downloadFile(@Param('id') id: string, @Req() req: any, @Res() res: any) {
    const fileId = this.parseFileId(id);
    const record = await this.getFileRecord(fileId);

    if (!record) {
      this.logger.warn(`[文件] 文件记录未找到: id=${fileId.toString()}`);
      return res.status(404).json({
        code: 404,
        message: '文件不存在',
        data: null,
        trace_id: req.trace_id,
      });
    }

    if (!this.canAccessFileRecord(req, record)) {
      this.logger.warn(
        `[文件] 越权下载被拦截: id=${fileId.toString()} user=${String(req?.user?.sub || '')}`,
      );
      throw new ForbiddenException('无权访问该文件');
    }

    let buffer: Buffer | null = null;

    if (this.minioService.isConfigured()) {
      buffer = await this.minioService.getBufferIfExists(
        this.minioService.getUploadBucket(),
        String(record.file_key || ''),
      );
    }

    if (!buffer) {
      const existingPath = await resolveExistingUploadFilePath(
        record.file_key,
        process.cwd(),
      );

      if (!existingPath) {
        this.logger.warn(
          `[文件] 文件缺失: id=${record.id.toString()} file_key=${String(record.file_key || '')} 候选路径=${JSON.stringify(
            getUploadRootCandidates(process.cwd()),
          )}`,
        );
        throw new NotFoundException('文件不存在');
      }

      buffer = await fs.readFile(existingPath);
    }

    res.setHeader('Content-Type', record.mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.end(buffer);
  }

  @Get(['files/:id', 'admin/files/:id'])
  async getFile(@Param('id') id: string, @Req() req: any) {
    const record = await this.getFileRecord(this.parseFileId(id));

    if (!record) {
      return {
        code: 404,
        message: '文件不存在',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (!this.canAccessFileRecord(req, record)) {
      return {
        code: 403,
        message: '无权访问该文件',
        data: null,
        trace_id: req.trace_id,
      };
    }

    return {
      code: 0,
      message: 'ok',
      data: this.serializeRecord(record, true),
      trace_id: req.trace_id,
    };
  }
}
