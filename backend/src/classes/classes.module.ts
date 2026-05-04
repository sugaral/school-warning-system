import { Module } from '@nestjs/common';
import { ClassesAdminController } from './classes.admin.controller';
import { PrismaModule } from '../shared/prisma.module';
import { RbacModule } from '../rbac/rbac.module';

@Module({
  imports: [PrismaModule, RbacModule],
  controllers: [ClassesAdminController],
})
export class ClassesModule {}
