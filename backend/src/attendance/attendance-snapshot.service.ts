import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../shared/prisma.service';

type SessionSnapshotRecord = {
  session_id: bigint;
  class_id: bigint;
  org_id: bigint;
  course_id: bigint;
  total_students: number;
  checked_in_count: number;
  on_time_count: number;
  late_count: number;
  leave_count: number;
  absent_count: number;
};

@Injectable()
export class AttendanceSnapshotService {
  private readonly logger = new Logger(AttendanceSnapshotService.name);

  constructor(private readonly prisma: PrismaService) {}

  async refreshSessions(values: Array<bigint | string | number | null | undefined>) {
    const sessionIds = this.uniqueBigInts(values);
    if (sessionIds.length === 0) {
      return;
    }

    const sessions = await this.prisma.class_sessions.findMany({
      where: {
        id: { in: sessionIds },
      },
      include: {
        classes: {
          select: {
            org_id: true,
          },
        },
      },
    });

    if (sessions.length === 0) {
      await this.deleteSessions(sessionIds);
      return;
    }

    const classIds = this.uniqueBigInts(sessions.map((session: any) => session.class_id));
    const minStart = new Date(
      Math.min(...sessions.map((session: any) => new Date(session.session_start).getTime())),
    );
    const maxEnd = new Date(
      Math.max(
        ...sessions.map((session: any) =>
          new Date(session.session_end || session.qr_expire_at).getTime(),
        ),
      ),
    );

    const [studentCounts, attendanceRecords, leaveRequests] = await Promise.all([
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
      this.prisma.attendance_records.findMany({
        where: {
          session_id: { in: sessionIds },
        },
        select: {
          session_id: true,
          student_id: true,
          attendance_status: true,
        },
      }),
      this.prisma.leave_requests.findMany({
        where: {
          class_id: { in: classIds },
          status: 'approved',
          from_date: { lte: maxEnd },
          to_date: { gte: minStart },
        },
        select: {
          class_id: true,
          student_id: true,
          from_date: true,
          to_date: true,
        },
      }),
    ]);

    const studentCountMap = new Map<string, number>(
      studentCounts.map((item: any) => [item.class_id.toString(), Number(item._count?.id || 0)]),
    );
    const recordMap = new Map<string, any[]>();
    attendanceRecords.forEach((record: any) => {
      const key = record.session_id.toString();
      const current = recordMap.get(key) || [];
      current.push(record);
      recordMap.set(key, current);
    });

    const rows: SessionSnapshotRecord[] = sessions.map((session: any) => {
      const records = recordMap.get(session.id.toString()) || [];
      const sessionDeadline = new Date(session.session_end || session.qr_expire_at);
      const totalStudents = studentCountMap.get(session.class_id.toString()) || 0;
      const recordStatusMap = new Map<string, string>();
      let onTimeCount = 0;
      let lateCount = 0;

      records.forEach((record: any) => {
        const status = String(record.attendance_status || '').trim();
        recordStatusMap.set(record.student_id.toString(), status);
        if (status === 'on_time') {
          onTimeCount += 1;
        } else if (status === 'late') {
          lateCount += 1;
        }
      });

      const checkedInCount = onTimeCount + lateCount;
      const effectiveLeaveIds = new Set<string>();
      leaveRequests.forEach((leaveRequest: any) => {
        if (leaveRequest.class_id.toString() !== session.class_id.toString()) {
          return;
        }
        const leaveStart = new Date(leaveRequest.from_date);
        const leaveEnd = new Date(leaveRequest.to_date);
        if (leaveStart <= sessionDeadline && leaveEnd >= new Date(session.session_start)) {
          effectiveLeaveIds.add(leaveRequest.student_id.toString());
        }
      });

      recordStatusMap.forEach((status, studentId) => {
        if (status === 'leave') {
          effectiveLeaveIds.add(studentId);
        }
      });

      const leaveCount = effectiveLeaveIds.size;
      const isEnded =
        String(session.status || '').trim() === 'ended' || sessionDeadline.getTime() <= Date.now();
      const absentCount = isEnded
        ? Math.max(totalStudents - leaveCount - checkedInCount, 0)
        : 0;

      return {
        session_id: session.id,
        class_id: session.class_id,
        org_id: session.classes?.org_id || 0n,
        course_id: session.course_id,
        total_students: totalStudents,
        checked_in_count: checkedInCount,
        on_time_count: onTimeCount,
        late_count: lateCount,
        leave_count: leaveCount,
        absent_count: absentCount,
      };
    });

    if (rows.length > 0) {
      const columns = [
        'session_id', 'class_id', 'org_id', 'course_id',
        'total_students', 'checked_in_count', 'on_time_count',
        'late_count', 'leave_count', 'absent_count', 'updated_at',
      ] as const;
      const now = new Date();
      const paramPlaceholders = rows
        .map(() => `(${columns.map(() => '?').join(', ')})`)
        .join(', ');
      const params: any[] = rows.flatMap((row) => [
        row.session_id, row.class_id, row.org_id, row.course_id,
        row.total_students, row.checked_in_count, row.on_time_count,
        row.late_count, row.leave_count, row.absent_count, now,
      ]);
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO class_session_snapshots (${columns.join(', ')})
         VALUES ${paramPlaceholders}
         AS new
         ON DUPLICATE KEY UPDATE
           class_id = new.class_id,
           org_id = new.org_id,
           course_id = new.course_id,
           total_students = new.total_students,
           checked_in_count = new.checked_in_count,
           on_time_count = new.on_time_count,
           late_count = new.late_count,
           leave_count = new.leave_count,
           absent_count = new.absent_count,
           updated_at = new.updated_at`,
        ...params,
      );
    }

    this.logger.log(
      `[签到快照] refresh sessions=${sessions.length}`,
    );
  }

  async getOrRefreshSessionSnapshots(values: Array<bigint | string | number | null | undefined>) {
    const sessionIds = this.uniqueBigInts(values);
    if (sessionIds.length === 0) {
      return new Map<string, any>();
    }

    let snapshots = await (this.prisma as any).class_session_snapshots.findMany({
      where: {
        session_id: { in: sessionIds },
      },
    });
    const snapshotMap = new Map(
      snapshots.map((item: any) => [item.session_id.toString(), item]),
    );
    const missingIds = sessionIds.filter((sessionId) => !snapshotMap.has(sessionId.toString()));

    if (missingIds.length > 0) {
      await this.refreshSessions(missingIds);
      snapshots = await (this.prisma as any).class_session_snapshots.findMany({
        where: {
          session_id: { in: sessionIds },
        },
      });
    }

    return new Map(
      snapshots.map((item: any) => [item.session_id.toString(), item]),
    );
  }

  async deleteSessions(values: Array<bigint | string | number | null | undefined>) {
    const sessionIds = this.uniqueBigInts(values);
    if (sessionIds.length === 0) {
      return;
    }

    await (this.prisma as any).class_session_snapshots.deleteMany({
      where: {
        session_id: { in: sessionIds },
      },
    });
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
        this.logger.warn(`跳过无效课次快照ID: ${String(value)}`);
      }
    }
    return Array.from(map.values());
  }
}
