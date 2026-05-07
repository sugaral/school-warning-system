import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Permissions } from '../rbac/permission.decorator';
import { PermissionGuard } from '../rbac/permission.guard';
import { AuthGuard } from '../shared/auth.guard';
import {
  buildFileSummaryMap,
  normalizeFileIdList,
  parseOptionalFileIds,
} from '../shared/file.util';
import { PrismaService } from '../shared/prisma.service';

type FeedbackStatus = 'pending' | 'claimed' | 'resolved';

class SubmitFeedbackDto {
  content!: string;
  source?: string;
  page_path?: string;
  page_title?: string;
  image_file_id?: string | number | bigint;
  image_file_ids?: Array<string | number | bigint>;
}

class HandleFeedbackDto {
  status!: string;
  handle_note?: string;
}

@Controller()
export class FeedbackController {
  constructor(private readonly prisma: PrismaService) {}

  private readonly feedbackStatuses: FeedbackStatus[] = [
    'pending',
    'claimed',
    'resolved',
  ];

  private normalizeText(value: unknown, maxLength: number) {
    return String(value || '').trim().slice(0, maxLength);
  }

  private parsePaginationValue(
    value: unknown,
    fallback: number,
    min: number,
    max: number,
  ) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, Math.floor(parsed)));
  }

  private parseBigInt(value: unknown, fieldName: string) {
    try {
      const normalized = String(value || '').trim();
      if (!normalized) {
        throw new Error('empty');
      }
      return BigInt(normalized);
    } catch {
      throw new BadRequestException(`${fieldName} 无效`);
    }
  }

  private parseOptionalFileId(value: unknown) {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return null;
    }
    return this.parseBigInt(normalized, '图片文件');
  }

  private normalizeStatus(value: unknown, allowEmpty = false): FeedbackStatus | '' {
    const normalized = String(value || '').trim().toLowerCase();

    if (!normalized) {
      return allowEmpty ? '' : 'pending';
    }

    if (normalized === 'processing') {
      return 'claimed';
    }

    if (this.feedbackStatuses.includes(normalized as FeedbackStatus)) {
      return normalized as FeedbackStatus;
    }

    throw new BadRequestException('反馈状态无效');
  }

  private getDetail(detailJson: unknown) {
    if (detailJson && typeof detailJson === 'object' && !Array.isArray(detailJson)) {
      return detailJson as Record<string, any>;
    }
    return {} as Record<string, any>;
  }

  private getFeedbackStatus(detailJson: unknown): FeedbackStatus {
    const detail = this.getDetail(detailJson);
    return (this.normalizeStatus(detail.status, true) || 'pending') as FeedbackStatus;
  }

  private getImageFileIds(detailJson: unknown) {
    const detail = this.getDetail(detailJson);
    return normalizeFileIdList(detail.image_file_ids, detail.image_file_id);
  }

  private buildStatusWhere(status: FeedbackStatus) {
    if (status === 'pending') {
      return {
        NOT: {
          OR: [
            { detail_json: { path: '$.status', equals: 'claimed' } },
            { detail_json: { path: '$.status', equals: 'processing' } },
            { detail_json: { path: '$.status', equals: 'resolved' } },
          ],
        },
      };
    }

    if (status === 'claimed') {
      return {
        OR: [
          { detail_json: { path: '$.status', equals: 'claimed' } },
          { detail_json: { path: '$.status', equals: 'processing' } },
        ],
      };
    }

    return {
      detail_json: {
        path: '$.status',
        equals: 'resolved',
      },
    };
  }

  private async loadUsersAndRoles(userIds: bigint[]) {
    if (userIds.length === 0) {
      return {
        userMap: new Map<string, any>(),
        roleMap: new Map<string, string[]>(),
      };
    }

    const [users, userRoles] = await Promise.all([
      this.prisma.users.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true,
          name: true,
          user_type: true,
          email: true,
          mobile: true,
        },
      }),
      this.prisma.user_roles.findMany({
        where: { user_id: { in: userIds } },
        orderBy: [{ user_id: 'asc' }, { created_at: 'asc' }],
      }),
    ]);

    const userMap = new Map(
      users.map((item) => [
        item.id.toString(),
        {
          id: item.id.toString(),
          name: item.name,
          user_type: item.user_type,
          email: item.email || '',
          mobile: item.mobile || '',
        },
      ]),
    );

    const roleMap = new Map<string, string[]>();
    userRoles.forEach((item) => {
      const key = item.user_id.toString();
      const roles = roleMap.get(key) || [];
      if (!roles.includes(item.role)) {
        roles.push(item.role);
      }
      roleMap.set(key, roles);
    });

    return {
      userMap,
      roleMap,
    };
  }

  private serializeFeedbackSummary(
    event: {
      id: bigint;
      user_id: bigint | null;
      detail_json: unknown;
      ip: string | null;
      created_at: Date;
    },
    userMap: Map<string, any>,
    roleMap: Map<string, string[]>,
    fileMap: Map<string, any> = new Map(),
  ) {
    const detail = this.getDetail(event.detail_json);
    const submitter = event.user_id ? userMap.get(event.user_id.toString()) : null;
    const roles = event.user_id ? roleMap.get(event.user_id.toString()) || [] : [];
    const imageFileIds = this.getImageFileIds(detail);

    return {
      id: event.id.toString(),
      user: detail.submitter_name || submitter?.name || '未知用户',
      user_id: submitter?.id || event.user_id?.toString() || '',
      user_type: submitter?.user_type || detail.user_type || '',
      user_email: detail.submitter_email || submitter?.email || '',
      user_mobile: detail.submitter_mobile || submitter?.mobile || '',
      roles,
      source: String(detail.source || ''),
      page_path: String(detail.page_path || ''),
      page_title: String(detail.page_title || ''),
      content: String(detail.content || ''),
      status: this.getFeedbackStatus(detail),
      handle_note: String(detail.handle_note || ''),
      handled_at: detail.handled_at || null,
      handled_by_name: String(detail.handled_by_name || ''),
      handled_by_user_id: String(detail.handled_by_user_id || ''),
      image_file_id: imageFileIds[0] || '',
      image_file: imageFileIds[0] ? fileMap.get(imageFileIds[0]) || null : null,
      image_file_ids: imageFileIds,
      image_files: imageFileIds
        .map((id) => fileMap.get(id) || null)
        .filter(Boolean),
      ip: event.ip || '',
      timestamp: event.created_at,
    };
  }

  @Post('feedback')
  @UseGuards(AuthGuard)
  async submitFeedback(@Body() dto: SubmitFeedbackDto, @Req() req: any) {
    const content = this.normalizeText(dto.content, 2000);
    if (!content) {
      throw new BadRequestException('建议内容不能为空');
    }

    const source = this.normalizeText(dto.source || 'admin-frontend', 48) || 'admin-frontend';
    const pagePath = this.normalizeText(dto.page_path, 255);
    const pageTitle = this.normalizeText(dto.page_title, 128);
    const userId = this.parseBigInt(req.user.userId, '用户 ID');
    const imageFileIds = Array.from(
      new Map(
        [
          ...parseOptionalFileIds(dto.image_file_ids, '图片文件'),
          ...parseOptionalFileIds(dto.image_file_id, '图片文件'),
        ].map((item) => [item.toString(), item]),
      ).values(),
    );

    const submitter = await this.prisma.users.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        mobile: true,
        user_type: true,
      },
    });

    const event = await this.prisma.security_events.create({
      data: {
        user_id: userId,
        event_type: 'user_feedback',
        detail_json: {
          content,
          source,
          page_path: pagePath || null,
          page_title: pageTitle || null,
          user_type: submitter?.user_type || req.user.user_type || null,
          submitter_name: submitter?.name || null,
          submitter_email: submitter?.email || null,
          submitter_mobile: submitter?.mobile || null,
          image_file_id: imageFileIds[0]?.toString() || null,
          image_file_ids: imageFileIds.map((item) => item.toString()),
          status: 'pending',
          handle_note: null,
          handled_at: null,
          handled_by_name: null,
          handled_by_user_id: null,
        } as any,
        ip: req.ip,
        user_agent: req.headers?.['user-agent']
          ? String(req.headers['user-agent']).slice(0, 255)
          : null,
      },
    });

    return {
      code: 0,
      message: '建议已提交到管理端',
      data: { id: event.id.toString() },
      trace_id: req.trace_id,
    };
  }

  @Post('admin/feedback/submit')
  @UseGuards(AuthGuard)
  async submitAdminFeedback(@Body() dto: SubmitFeedbackDto, @Req() req: any) {
    return this.submitFeedback(dto, req);
  }

  @Get('admin/feedback')
  @UseGuards(AuthGuard, PermissionGuard)
  @Permissions('audit:view')
  async listFeedbacks(
    @Query('page') page: number = 1,
    @Query('pageSize') pageSize: number = 20,
    @Query('source') source?: string,
    @Query('status') status?: string,
    @Req() req?: any,
  ) {
    const safePage = this.parsePaginationValue(page, 1, 1, 100000);
    const safePageSize = this.parsePaginationValue(pageSize, 20, 10, 100);
    const normalizedSource = this.normalizeText(source, 48);
    const normalizedStatus = this.normalizeStatus(status, true);

    const baseWhere: any = {
      event_type: 'user_feedback',
    };

    const summaryWhere: any = normalizedSource
      ? {
          AND: [
            baseWhere,
            {
              detail_json: {
                path: '$.source',
                equals: normalizedSource,
              },
            },
          ],
        }
      : baseWhere;

    const listWhere: any = normalizedStatus
      ? {
          AND: [summaryWhere, this.buildStatusWhere(normalizedStatus as FeedbackStatus)],
        }
      : summaryWhere;

    const [events, total, summaryTotal, claimedCount, resolvedCount] = await Promise.all([
      this.prisma.security_events.findMany({
        where: listWhere,
        orderBy: { created_at: 'desc' },
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
      }),
      this.prisma.security_events.count({ where: listWhere }),
      this.prisma.security_events.count({ where: summaryWhere }),
      this.prisma.security_events.count({
        where: {
          AND: [summaryWhere, this.buildStatusWhere('claimed')],
        },
      }),
      this.prisma.security_events.count({
        where: {
          AND: [summaryWhere, this.buildStatusWhere('resolved')],
        },
      }),
    ]);

    const pendingCount = Math.max(0, summaryTotal - claimedCount - resolvedCount);

    const userIds = events
      .map((item) => item.user_id)
      .filter((value): value is bigint => value !== null);
    const fileIds = events.flatMap((item) =>
      this.getImageFileIds(item.detail_json).map((fileId) => BigInt(fileId)),
    );
    const [{ userMap, roleMap }, fileMap] = await Promise.all([
      this.loadUsersAndRoles(userIds),
      buildFileSummaryMap(this.prisma, fileIds),
    ]);

    return {
      code: 0,
      message: 'ok',
      data: {
        list: events.map((item) =>
          this.serializeFeedbackSummary(item, userMap, roleMap, fileMap),
        ),
        summary: {
          total: summaryTotal,
          pending: pendingCount,
          claimed: claimedCount,
          resolved: resolvedCount,
        },
        pagination: {
          page: safePage,
          pageSize: safePageSize,
          total,
          totalPages: Math.ceil(total / safePageSize),
        },
      },
      trace_id: req?.trace_id,
    };
  }

  @Get('admin/feedback/:id')
  @UseGuards(AuthGuard, PermissionGuard)
  @Permissions('audit:view')
  async getFeedbackDetail(@Param('id') id: string, @Req() req: any) {
    const feedbackId = this.parseBigInt(id, '反馈 ID');

    const event = await this.prisma.security_events.findUnique({
      where: { id: feedbackId },
    });

    if (!event || event.event_type !== 'user_feedback') {
      return {
        code: 404,
        message: '未找到对应建议',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const detail = this.getDetail(event.detail_json);
    const imageFileIds = this.getImageFileIds(detail);
    const user = event.user_id
      ? await this.prisma.users.findUnique({
          where: { id: event.user_id },
          select: {
            id: true,
            name: true,
            user_type: true,
            email: true,
            mobile: true,
          },
        })
      : null;

    const roles = event.user_id
      ? await this.prisma.user_roles.findMany({
          where: { user_id: event.user_id },
          orderBy: { created_at: 'asc' },
        })
      : [];
    const fileMap = await buildFileSummaryMap(
      this.prisma,
      imageFileIds.map((fileId) => BigInt(fileId)),
    );

    return {
      code: 0,
      message: 'ok',
      data: {
        id: event.id.toString(),
        user: detail.submitter_name || user?.name || '未知用户',
        user_id: user?.id?.toString() || event.user_id?.toString() || '',
        user_type: user?.user_type || detail.user_type || '',
        user_email: detail.submitter_email || user?.email || '',
        user_mobile: detail.submitter_mobile || user?.mobile || '',
        roles: roles.map((item) => item.role),
        source: String(detail.source || ''),
        page_path: String(detail.page_path || ''),
        page_title: String(detail.page_title || ''),
        content: String(detail.content || ''),
        status: this.getFeedbackStatus(detail),
        handle_note: String(detail.handle_note || ''),
        handled_at: detail.handled_at || null,
        handled_by_name: String(detail.handled_by_name || ''),
        handled_by_user_id: String(detail.handled_by_user_id || ''),
        image_file_id: imageFileIds[0] || '',
        image_file: imageFileIds[0] ? fileMap.get(imageFileIds[0]) || null : null,
        image_file_ids: imageFileIds,
        image_files: imageFileIds
          .map((fileId) => fileMap.get(fileId) || null)
          .filter(Boolean),
        ip: event.ip || '',
        user_agent: event.user_agent || '',
        timestamp: event.created_at,
      },
      trace_id: req.trace_id,
    };
  }

  @Post('admin/feedback/:id/handle')
  @UseGuards(AuthGuard, PermissionGuard)
  @Permissions('audit:view')
  async handleFeedback(
    @Param('id') id: string,
    @Body() dto: HandleFeedbackDto,
    @Req() req: any,
  ) {
    const feedbackId = this.parseBigInt(id, '反馈 ID');
    const status = this.normalizeStatus(dto.status, false) as FeedbackStatus;
    const handleNote = this.normalizeText(dto.handle_note, 2000);
    const operatorId = this.parseBigInt(req.user.userId, '用户 ID');

    const [event, operator] = await Promise.all([
      this.prisma.security_events.findUnique({
        where: { id: feedbackId },
      }),
      this.prisma.users.findUnique({
        where: { id: operatorId },
        select: { id: true, name: true },
      }),
    ]);

    if (!event || event.event_type !== 'user_feedback') {
      return {
        code: 404,
        message: '未找到对应建议',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const detail = this.getDetail(event.detail_json);
    const beforeStatus = this.getFeedbackStatus(detail);
    const beforeHandleNote = String(detail.handle_note || '');
    const handledAt = status === 'pending' ? null : new Date().toISOString();
    const handledByName = status === 'pending' ? null : operator?.name || '管理员';
    const handledByUserId = status === 'pending' ? null : operatorId.toString();

    const nextDetail = {
      ...detail,
      status,
      handle_note: handleNote || null,
      handled_at: handledAt,
      handled_by_name: handledByName,
      handled_by_user_id: handledByUserId,
    };

    await Promise.all([
      this.prisma.security_events.update({
        where: { id: feedbackId },
        data: {
          detail_json: nextDetail as any,
        },
      }),
      this.prisma.audit_logs.create({
        data: {
          actor_user_id: operatorId,
          action: status === 'claimed' ? 'feedback.claim' : 'feedback.handle',
          entity_type: 'feedback',
          entity_id: feedbackId,
          before_json: {
            status: beforeStatus,
            handle_note: beforeHandleNote || null,
          } as any,
          after_json: {
            status,
            handle_note: handleNote || null,
            handled_at: handledAt,
            handled_by_name: handledByName,
            handled_by_user_id: handledByUserId,
          } as any,
          ip: req.ip,
          user_agent: req.headers?.['user-agent']
            ? String(req.headers['user-agent']).slice(0, 255)
            : null,
        },
      }),
    ]);

    const refreshedEvent = await this.prisma.security_events.findUnique({
      where: { id: feedbackId },
    });

    const submitterIds = refreshedEvent?.user_id ? [refreshedEvent.user_id] : [];
    const imageFileIds = refreshedEvent
      ? this.getImageFileIds(refreshedEvent.detail_json)
      : [];
    const [{ userMap, roleMap }, fileMap] = await Promise.all([
      this.loadUsersAndRoles(submitterIds),
      buildFileSummaryMap(
        this.prisma,
        imageFileIds.map((fileId) => BigInt(fileId)),
      ),
    ]);

    return {
      code: 0,
      message:
        status === 'claimed'
          ? '建议已认领'
          : status === 'resolved'
            ? '建议已标记为已解决'
            : '建议已恢复为待认领',
      data: refreshedEvent
        ? this.serializeFeedbackSummary(refreshedEvent, userMap, roleMap, fileMap)
        : null,
      trace_id: req.trace_id,
    };
  }
}
