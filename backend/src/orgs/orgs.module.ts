import { Module } from '@nestjs/common';
import { OrgsController } from './orgs.controller';
import { PrismaService } from '../shared/prisma.service';

@Module({
  controllers: [OrgsController],
  providers: [PrismaService],
})
export class OrgsModule {}
