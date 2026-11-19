import { Global, Module } from '@nestjs/common';
import { NotificationCenterService } from './notification-center.service';
import { NotificationCenterController } from './notification-center.controller';

/**
 * 站内消息中心模块（复活僵尸表 `notification`）
 *
 * 声明为 @Global 的理由与 MinioModule 相同：
 * 预警服务、班级公告、未来的系统通知都要往站内消息写入，
 * 逐个 module 里 imports 会非常啰嗦，且容易漏。
 */
@Global()
@Module({
  controllers: [NotificationCenterController],
  providers: [NotificationCenterService],
  exports: [NotificationCenterService],
})
export class NotificationCenterModule {}
