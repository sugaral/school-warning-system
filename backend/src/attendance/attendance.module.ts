import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceSnapshotService } from './attendance-snapshot.service';
import { PrismaModule } from '../shared/prisma.module';
import { WarningModule } from '../warning/warning.module';
import { SystemConfigModule } from '../config/config.module';

@Module({
  imports: [PrismaModule, WarningModule, SystemConfigModule],
  controllers: [AttendanceController],
  providers: [AttendanceSnapshotService],
  exports: [AttendanceSnapshotService],
})
export class AttendanceModule {}
