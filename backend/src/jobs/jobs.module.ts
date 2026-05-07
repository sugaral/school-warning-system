import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { WarningModule } from '../warning/warning.module';

@Module({
  imports: [WarningModule, SchedulerModule],
  controllers: [JobsController],
  providers: [],
})
export class JobsModule {}
