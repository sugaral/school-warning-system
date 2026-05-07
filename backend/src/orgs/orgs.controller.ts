import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../shared/prisma.service';
import { AuthGuard } from '../shared/auth.guard';
import { PermissionGuard } from '../rbac/permission.guard';
import { Permissions } from '../rbac/permission.decorator';

class CreateOrgDto {
  org_name!: string;
  org_code!: string;
  status?: string;
}

class UpdateOrgDto {
  org_name?: string;
  org_code?: string;
  status?: string;
}

class CreateMajorDto {
  org_id!: string;
  name!: string;
  code?: string;
  status?: string;
}

class UpdateMajorDto {
  name?: string;
  code?: string;
  status?: string;
}

@Controller('orgs')
@UseGuards(AuthGuard, PermissionGuard)
export class OrgsController {
  private readonly payloadCache = new Map<string, { data: any; expiresAt: number }>();
  private readonly cacheTtlSeconds = 60;

  constructor(
    private readonly prisma: PrismaService,
  ) {}

  private buildOrgsListVersionKey() {
    return 'orgs:list:version';
  }

  private buildOrgMajorsVersionKey(orgId: string) {
    return `orgs:majors:${String(orgId || '').trim() || 'none'}:version`;
  }

  private async getVersionedCacheKey(baseKey: string, versionKey: string) {
    return baseKey;
  }

  private async getCachedPayload<T>(cacheKey: string, loader: () => Promise<T>) {
    const now = Date.now();
    const cached = this.payloadCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.data as T;
    }
    const data = await loader();
    this.payloadCache.set(cacheKey, { data, expiresAt: now + this.cacheTtlSeconds * 1000 });
    return data;
  }

  private async invalidateOrgCaches(orgId?: string) {
    if (orgId) {
      for (const key of this.payloadCache.keys()) {
        if (key.includes(orgId)) {
          this.payloadCache.delete(key);
        }
      }
    } else {
      this.payloadCache.clear();
    }
  }

  @Get()
  @Permissions('system:config', 'class:read', 'course:read', 'schedule:read', 'user:manage', 'role:manage', 'permission:manage', 'stats:view')
  async listOrgs(@Req() req?: any) {
    const cacheKey = await this.getVersionedCacheKey('orgs:list', this.buildOrgsListVersionKey());
    const data = await this.getCachedPayload(cacheKey, async () => {
      const orgs = await this.prisma.orgs.findMany({
        orderBy: { id: 'asc' },
      });

      return orgs.map((org: any) => ({
        id: org.id.toString(),
        org_name: org.name,
        org_code: org.org_kind,
        status: org.status,
        created_at: org.created_at,
      }));
    });

    return {
      code: 0,
      message: 'ok',
      data,
      trace_id: req.trace_id,
    };
  }

  @Post()
  @Permissions('system:config')
  async createOrg(@Body() dto: CreateOrgDto, @Req() req: any) {
    const org = await this.prisma.orgs.create({
      data: {
        name: dto.org_name,
        org_kind: dto.org_code,
        status: dto.status || 'active',
      },
    });
    await this.invalidateOrgCaches();

    return {
      code: 0,
      message: '创建成功',
      data: {
        id: org.id.toString(),
        org_name: org.name,
        org_code: org.org_kind,
        status: org.status,
      },
      trace_id: req.trace_id,
    };
  }

  @Put(':id')
  @Permissions('system:config')
  async updateOrg(
    @Param('id') id: string,
    @Body() dto: UpdateOrgDto,
    @Req() req: any,
  ) {
    const org = await this.prisma.orgs.findUnique({
      where: { id: BigInt(id) },
    });

    if (!org) {
      return {
        code: 404,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const updateData: any = {};
    if (dto.org_name) updateData.name = dto.org_name;
    if (dto.org_code) updateData.org_kind = dto.org_code;
    if (dto.status) updateData.status = dto.status;

    const updatedOrg = await this.prisma.orgs.update({
      where: { id: BigInt(id) },
      data: updateData,
    });
    await this.invalidateOrgCaches(id);

    return {
      code: 0,
      message: '更新成功',
      data: {
        id: updatedOrg.id.toString(),
        org_name: updatedOrg.name,
        org_code: updatedOrg.org_kind,
        status: updatedOrg.status,
      },
      trace_id: req.trace_id,
    };
  }

  @Delete(':id')
  @Permissions('system:config')
  async deleteOrg(@Param('id') id: string, @Req() req: any) {
    const org = await this.prisma.orgs.findUnique({
      where: { id: BigInt(id) },
    });

    if (!org) {
      return {
        code: 404,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const orgId = BigInt(id);
    const [classCount, majorCount, courseCount, userCount] = await Promise.all([
      this.prisma.classes.count({
        where: { org_id: orgId },
      }),
      this.prisma.majors.count({
        where: { org_id: orgId },
      }),
      this.prisma.courses.count({
        where: { org_id: orgId },
      }),
      this.prisma.users.count({
        where: { org_id: orgId },
      }),
    ]);

    const blockers: string[] = [];
    if (classCount > 0) blockers.push(`班级 ${classCount} 个`);
    if (majorCount > 0) blockers.push(`专业 ${majorCount} 个`);
    if (courseCount > 0) blockers.push(`课程 ${courseCount} 个`);
    if (userCount > 0) blockers.push(`用户 ${userCount} 个`);

    if (blockers.length > 0) {
      return {
        code: 400,
        message: `该学院下仍有关联数据：${blockers.join('、')}，请先清理后再删除`,
        data: null,
        trace_id: req.trace_id,
      };
    }

    try {
      await this.prisma.orgs.delete({
        where: { id: orgId },
      });
    } catch (error: any) {
      return {
        code: 400,
        message: error?.message || '删除学院失败，请先清理关联数据后再试',
        data: null,
        trace_id: req.trace_id,
      };
    }
    await this.invalidateOrgCaches(id);

    return {
      code: 0,
      message: '删除成功',
      data: null,
      trace_id: req.trace_id,
    };
  }

  @Get(':orgId/majors')
  @Permissions('system:config', 'class:read', 'course:read', 'schedule:read', 'user:manage', 'role:manage', 'permission:manage', 'stats:view')
  async listMajors(@Param('orgId') orgId: string, @Req() req?: any) {
    const cacheKey = await this.getVersionedCacheKey(
      `orgs:majors:${String(orgId || '').trim() || 'none'}`,
      this.buildOrgMajorsVersionKey(orgId),
    );
    const data = await this.getCachedPayload(cacheKey, async () => {
      const majors = await this.prisma.majors.findMany({
        where: {
          org_id: BigInt(orgId),
        },
        orderBy: { id: 'asc' },
      });

      return majors.map((major: any) => ({
        id: major.id.toString(),
        org_id: major.org_id.toString(),
        name: major.name,
        code: major.code,
        status: major.status,
        created_at: major.created_at,
      }));
    });

    return {
      code: 0,
      message: 'ok',
      data,
      trace_id: req.trace_id,
    };
  }

  @Post(':orgId/majors')
  @Permissions('system:config')
  async createMajor(
    @Param('orgId') orgId: string,
    @Body() dto: CreateMajorDto,
    @Req() req: any,
  ) {
    const major = await this.prisma.majors.create({
      data: {
        org_id: BigInt(orgId),
        name: dto.name,
        code: dto.code,
        status: dto.status || 'active',
      },
    });
    await this.invalidateOrgCaches(orgId);

    return {
      code: 0,
      message: '创建成功',
      data: {
        id: major.id.toString(),
        org_id: major.org_id.toString(),
        name: major.name,
        code: major.code,
        status: major.status,
      },
      trace_id: req.trace_id,
    };
  }

  @Put('majors/:id')
  @Permissions('system:config')
  async updateMajor(
    @Param('id') id: string,
    @Body() dto: UpdateMajorDto,
    @Req() req: any,
  ) {
    const major = await this.prisma.majors.findUnique({
      where: { id: BigInt(id) },
    });

    if (!major) {
      return {
        code: 404,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const updateData: any = {};
    if (dto.name) updateData.name = dto.name;
    if (dto.code) updateData.code = dto.code;
    if (dto.status) updateData.status = dto.status;

    const updatedMajor = await this.prisma.majors.update({
      where: { id: BigInt(id) },
      data: updateData,
    });
    await this.invalidateOrgCaches(updatedMajor.org_id.toString());

    return {
      code: 0,
      message: '更新成功',
      data: {
        id: updatedMajor.id.toString(),
        org_id: updatedMajor.org_id.toString(),
        name: updatedMajor.name,
        code: updatedMajor.code,
        status: updatedMajor.status,
      },
      trace_id: req.trace_id,
    };
  }

  @Delete('majors/:id')
  @Permissions('system:config')
  async deleteMajor(@Param('id') id: string, @Req() req: any) {
    const major = await this.prisma.majors.findUnique({
      where: { id: BigInt(id) },
    });

    if (!major) {
      return {
        code: 404,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const majorId = BigInt(id);
    const [classCount, studentCount] = await Promise.all([
      this.prisma.classes.count({
        where: { major_id: majorId },
      }),
      this.prisma.student_profiles.count({
        where: { major_id: majorId },
      }),
    ]);

    const blockers: string[] = [];
    if (classCount > 0) blockers.push(`班级 ${classCount} 个`);
    if (studentCount > 0) blockers.push(`学生档案 ${studentCount} 个`);

    if (blockers.length > 0) {
      return {
        code: 400,
        message: `该专业下仍有关联数据：${blockers.join('、')}，请先清理后再删除`,
        data: null,
        trace_id: req.trace_id,
      };
    }

    try {
      await this.prisma.majors.delete({
        where: { id: majorId },
      });
    } catch (error: any) {
      return {
        code: 400,
        message: error?.message || '删除专业失败，请先清理关联数据后再试',
        data: null,
        trace_id: req.trace_id,
      };
    }
    await this.invalidateOrgCaches(major.org_id.toString());

    return {
      code: 0,
      message: '删除成功',
      data: null,
      trace_id: req.trace_id,
    };
  }
}

