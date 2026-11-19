import { Module } from '@nestjs/common';
import { TeacherController } from './teacher.controller';
import { PrismaService } from '../shared/prisma.service';
import { WarningModule } from '../warning/warning.module';
import { SystemConfigModule } from '../config/config.module';

@Module({
  imports: [WarningModule, SystemConfigModule],
  controllers: [TeacherController],
  providers: [PrismaService],
})
export class TeacherModule {}
