import { Module } from '@nestjs/common';
import { TeachersAdminController } from './teachers.admin.controller';
import { HeadTeacherController } from './head-teacher.controller';
import { PrismaModule } from '../shared/prisma.module';
import { RbacModule } from '../rbac/rbac.module';

@Module({
  imports: [PrismaModule, RbacModule],
  controllers: [TeachersAdminController, HeadTeacherController],
})
export class TeachersModule {}
