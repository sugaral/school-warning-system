import { Module } from '@nestjs/common';
import { ClassMonitorController } from './class-monitor.controller';
import { ClassMonitorSnapshotService } from './class-monitor-snapshot.service';
import { PrismaModule } from '../shared/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ClassMonitorController],
  providers: [ClassMonitorSnapshotService],
})
export class ClassMonitorModule {}
