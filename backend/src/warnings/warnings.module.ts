import { Module } from '@nestjs/common';
import { WarningsController } from './warnings.controller';
import { WarningsAdminController } from './warnings.admin.controller';
import { PrismaModule } from '../shared/prisma.module';
import { RbacModule } from '../rbac/rbac.module';
import { WarningModule } from '../warning/warning.module';
import { SystemConfigModule } from '../config/config.module';

@Module({
  imports: [PrismaModule, RbacModule, WarningModule, SystemConfigModule],
  controllers: [WarningsController, WarningsAdminController],
})
export class WarningsModule {}
