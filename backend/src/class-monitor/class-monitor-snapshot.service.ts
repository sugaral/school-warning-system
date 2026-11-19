import { Injectable, Logger } from '@nestjs/common';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { PrismaService } from '../shared/prisma.service';

dayjs.extend(utc);
dayjs.extend(timezone);

const DEFAULT_TZ = 'Asia/Shanghai';
const ACTIVE_WARNING_STATUSES = ['open', 'acknowledged'];
const SNAPSHOT_MAX_AGE_MS = 60 * 1000;

@Injectable()
export class ClassMonitorSnapshotService {
  private readonly logger = new Logger(ClassMonitorSnapshotService.name);

  constructor(private readonly prisma: PrismaService) {}

  async refreshClasses(values: Array<bigint | string | number | null | undefined>) {
    const classIds = this.uniqueBigInts(values);
    if (classIds.length === 0) {
      return;
    }

    const todayStart = dayjs().tz(DEFAULT_TZ).startOf('day').toDate();
    const tomorrowStart = dayjs().tz(DEFAULT_TZ).startOf('day').add(1, 'day').toDate();

    const [classes, studentCounts, warningRows, leaveCounts] = await Promise.all([
      this.prisma.classes.findMany({
        where: {
          id: { in: classIds },
        },
        select: {
          id: true,
          org_id: true,
        },
      }),
      this.prisma.student_profiles.groupBy({
        by: ['class_id'],
        where: {
          class_id: { in: classIds },
          status: 'active',
        },
        _count: {
          id: true,
        },
      }),
      (this.prisma as any).warning_current_states.groupBy({
        by: ['class_id', 'level'],
        where: {
          class_id: { in: classIds },
          status: { in: ACTIVE_WARNING_STATUSES },
        },
        _count: {
          id: true,
        },
      }),
      this.prisma.leave_requests.groupBy({
        by: ['class_id'],
        where: {
          class_id: { in: classIds },
          status: 'approved',
          from_date: { lte: tomorrowStart },
          to_date: { gte: todayStart },
        },
        _count: {
          id: true,
        },
      }),
    ]);

    const studentCountMap = new Map(
      studentCounts.map((item: any) => [item.class_id.toString(), Number(item._count?.id || 0)]),
    );
    const leaveCountMap = new Map(
      leaveCounts.map((item: any) => [item.class_id.toString(), Number(item._count?.id || 0)]),
    );
    const warningCountMap = new Map<string, { total: number; red: number }>();
    warningRows.forEach((row: any) => {
      const key = row.class_id.toString();
      const current = warningCountMap.get(key) || { total: 0, red: 0 };
      const count = Number(row._count?.id || 0);
      current.total += count;
      if (String(row.level || '').trim().toLowerCase() === 'red') {
        current.red += count;
      }
      warningCountMap.set(key, current);
    });

    const rows = classes.map((item: any) => {
      const key = item.id.toString();
      const warningCount = warningCountMap.get(key) || { total: 0, red: 0 };
      return {
        class_id: item.id,
        org_id: item.org_id,
        total_students: studentCountMap.get(key) || 0,
        warning_count: warningCount.total,
        red_warning_count: warningCount.red,
        leave_count: leaveCountMap.get(key) || 0,
      };
    });

    await this.prisma.$transaction(async (tx) => {
      await (tx as any).class_monitor_snapshots.deleteMany({
        where: {
          class_id: { in: classIds },
        },
      });

      if (rows.length > 0) {
        await (tx as any).class_monitor_snapshots.createMany({
          data: rows,
        });
      }
    });

    this.logger.log(`[班级监控快照] 刷新 班级数=${classIds.length}`);
  }

  async getOrRefreshClassSnapshot(classId: bigint) {
    let snapshot = await (this.prisma as any).class_monitor_snapshots.findUnique({
      where: {
        class_id: classId,
      },
    });

    if (
      !snapshot ||
      !snapshot.updated_at ||
      Date.now() - new Date(snapshot.updated_at).getTime() > SNAPSHOT_MAX_AGE_MS
    ) {
      await this.refreshClasses([classId]);
      snapshot = await (this.prisma as any).class_monitor_snapshots.findUnique({
        where: {
          class_id: classId,
        },
      });
    }

    return snapshot;
  }

  private uniqueBigInts(values: Array<bigint | string | number | null | undefined>) {
    const map = new Map<string, bigint>();
    for (const value of values) {
      if (value === null || value === undefined || value === '') {
        continue;
      }
      try {
        const bigintValue = BigInt(value as any);
        map.set(bigintValue.toString(), bigintValue);
      } catch {
        this.logger.warn(`跳过无效班级快照ID: ${String(value)}`);
      }
    }
    return Array.from(map.values());
  }
}
