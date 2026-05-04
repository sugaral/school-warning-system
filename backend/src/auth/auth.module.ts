import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { PrismaModule } from '../shared/prisma.module';
import { SystemConfigModule } from '../config/config.module';

@Module({
  imports: [PrismaModule, SystemConfigModule],
  controllers: [AuthController],
})
export class AuthModule {}
