import { Module } from '@nestjs/common';
import { TeachingAdminController } from './teaching-admin.controller';
import { PrismaModule } from '../shared/prisma.module';
import { SystemConfigModule } from '../config/config.module';

@Module({
  imports: [PrismaModule, SystemConfigModule],
  controllers: [TeachingAdminController],
})
export class TeachingAdminModule {}
