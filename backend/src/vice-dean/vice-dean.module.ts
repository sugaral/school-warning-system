import { Module } from '@nestjs/common';
import { PrismaModule } from '../shared/prisma.module';
import { ViceDeanController } from './vice-dean.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ViceDeanController],
})
export class ViceDeanModule {}
