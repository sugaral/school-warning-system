import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditManageController } from './audit.manage.controller';
import { PrismaModule } from '../shared/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AuditController, AuditManageController],
})
export class AuditModule {}
