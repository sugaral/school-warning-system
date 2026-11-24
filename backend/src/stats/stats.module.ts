import { Module } from '@nestjs/common';
import { StatsController } from './stats.controller';
import { PrismaModule } from '../shared/prisma.module';
import { SystemConfigModule } from '../config/config.module';

@Module({
  imports: [PrismaModule, SystemConfigModule],
  controllers: [StatsController],
})
export class StatsModule {}
