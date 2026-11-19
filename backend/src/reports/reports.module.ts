import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ExportProcessorService } from './export-processor.service';
import { PrismaModule } from '../shared/prisma.module';
import { SystemConfigModule } from '../config/config.module';

/**
 * 报表模块
 *
 * P1-7：导出改为真实异步 —— 控制器只负责入队，实际生成由
 * ExportProcessorService 的 @Cron 在工作进程（worker 容器）中消费。
 */
@Module({
  imports: [PrismaModule, SystemConfigModule],
  controllers: [ReportsController],
  providers: [ExportProcessorService],
  exports: [ExportProcessorService],
})
export class ReportsModule {}
