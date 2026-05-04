import { Module } from '@nestjs/common';
import { PrismaModule } from '../shared/prisma.module';
import { WarningCasesController } from './warning-cases.controller';
import { WarningCasesService } from './warning-cases.service';

@Module({
  imports: [PrismaModule],
  controllers: [WarningCasesController],
  providers: [WarningCasesService],
  exports: [WarningCasesService],
})
export class WarningCasesModule {}
