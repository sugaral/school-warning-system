import { Module } from '@nestjs/common';
import { RequestsController } from './requests.controller';
import { PrismaService } from '../shared/prisma.service';
import { WarningModule } from '../warning/warning.module';

@Module({
  imports: [WarningModule],
  controllers: [RequestsController],
  providers: [PrismaService],
})
export class RequestsModule {}

