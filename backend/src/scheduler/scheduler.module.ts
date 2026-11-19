import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AttendanceSchedulerService } from './attendance-scheduler.service';
import { SessionAutoCloseService } from './session-auto-close.service';
import { AttendanceModule } from '../attendance/attendance.module';
import { PrismaModule } from '../shared/prisma.module';
import { WarningModule } from '../warning/warning.module';
import { SystemConfigModule } from '../config/config.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    AttendanceModule,
    PrismaModule,
    WarningModule,
    SystemConfigModule,
  ],
  providers: [AttendanceSchedulerService, SessionAutoCloseService],
  exports: [AttendanceSchedulerService, SessionAutoCloseService],
})
export class SchedulerModule {}
