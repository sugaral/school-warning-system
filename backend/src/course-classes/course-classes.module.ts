import { Module } from '@nestjs/common';
import { PrismaModule } from '../shared/prisma.module';
import { CourseClassesAdminController } from './course-classes.admin.controller';
import { RbacModule } from '../rbac/rbac.module';

@Module({
  imports: [PrismaModule, RbacModule],
  controllers: [CourseClassesAdminController],
  providers: [],
})
export class CourseClassesModule {}
