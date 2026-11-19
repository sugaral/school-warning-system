import { Module } from '@nestjs/common';
import { StudentAdminController } from './student-admin.controller';
import { PrismaModule } from '../shared/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [StudentAdminController],
})
export class StudentAdminModule {}
