import { Module } from '@nestjs/common';
import { StatsController } from './stats.controller';
import { PrismaModule } from '../shared/prisma.module';
import { WarningCasesModule } from '../warning-cases/warning-cases.module';
import { SystemConfigModule } from '../config/config.module';

@Module({
  imports: [PrismaModule, WarningCasesModule, SystemConfigModule],
  controllers: [StatsController],
})
export class StatsModule {}
