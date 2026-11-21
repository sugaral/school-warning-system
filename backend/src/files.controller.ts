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
import { join } from 'path';
import { PinoLogger } from 'nestjs-pino';
import { AuthGuard } from './shared/auth.guard';
import { PermissionGuard } from './rbac/permission.guard';
import { PermissionService } from './rbac/permission.service';
import { serializeFileRecord } from './shared/file.util';
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
    private readonly permissionService: PermissionService,
  ) {
    this.logger.setContext('FilesController');
  }

  private validateImageMagicBytes(buffer: Buffer, mimetype: string): boolean {
    if (!buffer || buffer.length < 4) {
      return false;
    }
    switch (mimetype) {
      case 'image/jpeg':
        return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
      case 'image/png':
        return (
          buffer.length >= 8 &&
          buffer[0] === 0x89 &&
          buffer[1] === 0x50 &&
          buffer[2] === 0x4e &&
          buffer[3] === 0x47 &&
          buffer[4] === 0x0d &&
          buffer[5] === 0x0a &&
          buffer[6] === 0x1a &&
          buffer[7] === 0x0a
        );
      case 'image/gif':
        return buffer.length >= 6 && buffer.subarray(0, 4).toString('ascii') === 'GIF8';
      case 'image/webp':
        return (
          buffer.length >= 12 &&
          buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
          buffer.subarray(8, 12).toString('ascii') === 'WEBP'
        );
      default:
        return false;
    }
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
    if (!this.validateImageMagicBytes(file.buffer, file.mimetype)) {
      throw new BadRequestException('文件内容与图片格式不匹配');
    }

    const source = this.normalizeSource(dto.source);
    const extension = fallbackExt;
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

    const userId = this.getUserId(req);
    if (record.uploader_user_id !== userId) {
      const allowed = await this.permissionService.hasAnyPermission(userId, [
        'file:download',
        'leave:read',
        'leave:approve',
        'appeal:read',
        'appeal:handle',
        'student:read',
        'warning:read',
        'report:read',
        'report:export',
      ]);
      if (!allowed) {
        throw new ForbiddenException('权限不足');
      }
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
    res.setHeader('X-Content-Type-Options', 'nosniff');
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

    return {
      code: 0,
      message: 'ok',
      data: this.serializeRecord(record, true),
      trace_id: req.trace_id,
    };
  }
}
