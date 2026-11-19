import { Module } from '@nestjs/common';
import { RulesController } from './rules.controller';
import { PrismaModule } from '../shared/prisma.module';
import { WarningModule } from '../warning/warning.module';

@Module({
  imports: [PrismaModule, WarningModule],
  controllers: [RulesController],
})
export class RulesModule {}
