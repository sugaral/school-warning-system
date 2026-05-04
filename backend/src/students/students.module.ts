import { Module } from '@nestjs/common';
import { StudentsController } from './students.controller';
import { StudentsAdminController } from './students.admin.controller';
import { PrismaModule } from '../shared/prisma.module';
import { RbacModule } from '../rbac/rbac.module';

@Module({
  imports: [PrismaModule, RbacModule],
  controllers: [StudentsController, StudentsAdminController],
})
export class StudentsModule {}
