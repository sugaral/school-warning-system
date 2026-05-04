import { Module } from '@nestjs/common';
import { PrismaModule } from '../shared/prisma.module';
import { RbacModule } from '../rbac/rbac.module';
import { SchedulesAdminController } from './schedules.admin.controller';
import { SchedulesController } from './schedules.controller';
import { SystemConfigModule } from '../config/config.module';

@Module({
  imports: [PrismaModule, RbacModule, SystemConfigModule],
  controllers: [SchedulesAdminController, SchedulesController],
  providers: [],
})
export class SchedulesModule {}
