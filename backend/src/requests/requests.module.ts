import { Module } from '@nestjs/common';
import { RequestsController } from './requests.controller';
import { WarningModule } from '../warning/warning.module';

@Module({
  imports: [WarningModule],
  controllers: [RequestsController],
  providers: [],
})
export class RequestsModule {}

