import { Module } from '@nestjs/common';
import { ConfigController } from './config.controller';
import { ConfigService } from './config.service';
import { NotificationOpenController } from './notification-open.controller';
import { PrismaModule } from '../shared/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ConfigController, NotificationOpenController],
  providers: [ConfigService],
  exports: [ConfigService],
})
export class SystemConfigModule {}
