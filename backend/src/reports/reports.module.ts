import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { PrismaModule } from '../shared/prisma.module';
import { SystemConfigModule } from '../config/config.module';

@Module({
  imports: [PrismaModule, SystemConfigModule],
  controllers: [ReportsController],
})
export class ReportsModule {}
