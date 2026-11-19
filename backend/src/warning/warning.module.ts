import { Module } from '@nestjs/common';
import { WarningService } from './warning.service';
import { WarningQueueService } from './warning-queue.service';
import { WarningSnapshotService } from './warning-snapshot.service';
import { NotificationDispatchService } from './notification-dispatch.service';
import { WarningProcessingService } from './warning-processing.service';
import { SessionWarningGenerationService } from './session-warning-generation.service';
import { SummaryService } from './summary.service';
import { SystemConfigModule } from '../config/config.module';
import { WarningCasesModule } from '../warning-cases/warning-cases.module';

@Module({
  imports: [WarningCasesModule, SystemConfigModule],
  providers: [WarningService, WarningQueueService, WarningSnapshotService, NotificationDispatchService, WarningProcessingService, SessionWarningGenerationService, SummaryService],
  exports: [WarningService, WarningQueueService, WarningSnapshotService, WarningProcessingService, SessionWarningGenerationService, SummaryService],
})
export class WarningModule {}
