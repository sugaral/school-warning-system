/**
 * 独立 Worker 常驻入口（P0-3 修复）
 *
 * 背景：原 `src/workers/notification.worker.ts` 是一个「一次性 CLI」——
 * 跑完一轮 `processNotificationJobs()` 就 disconnect 退出，且全仓库无任何
 * import、docker-compose 中也没有对应服务，属于孤儿代码。
 * 结果：API 容器既处理 HTTP 又消费后台队列，无法独立扩容、无法隔离故障。
 *
 * 本入口的设计取舍（重要）：
 * 它 **不是** 去 import 那个 CLI 文件，而是用 `createApplicationContext(AppModule)`
 * 启动完整的 Nest 应用上下文但 **不监听 HTTP 端口**。这样做的原因：
 *  1. 复用与 API 完全相同的模块图与全部 `@Cron` 定时任务
 *     （通知派发、考勤调度、预警重算、快照刷新等），
 *     避免出现「第二套调度实现」导致两条代码路径行为漂移；
 *  2. 无需为 worker 单独维护一份依赖注入装配代码；
 *  3. worker 与 API 使用同一份镜像与同一套配置，部署面最小。
 *
 * 与 API 的分工（避免重复消费）：
 *  - worker 容器：NOTIFICATION_DISPATCH_ENABLED=true  → 消费通知任务队列
 *  - API 容器   ：NOTIFICATION_DISPATCH_ENABLED=false → 只处理 HTTP 请求，
 *                 不做后台派发（分布式锁仍作为多副本兜底保留）
 *  - Redis Streams 预警队列由 WARNING_QUEUE_CONSUMER_ENABLED 单独控制，
 *    默认只在 worker 中开启消费。
 *
 * 另外，worker 常驻还会周期调用 notification.worker.ts 中已被验证的
 * `processNotificationJobs()`（含 sms/email 真实发送、cooldown 判断、
 * 限流延后、审计落库），作为派发链路的补充兜底。
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

const logger = new Logger('Worker');

/** worker 兜底轮询间隔（毫秒），默认 30s */
function getFallbackIntervalMs(): number {
  const raw = Number(process.env.NOTIFICATION_WORKER_INTERVAL_MS || 30000);
  if (!Number.isFinite(raw) || raw < 5000) return 30000;
  return Math.min(raw, 600000);
}

async function bootstrap() {
  // 关键：createApplicationContext 不会监听 HTTP 端口，
  // 但会完整初始化所有 provider 并激活 @Cron 定时任务。
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  await app.init();

  logger.log('==============================================');
  logger.log(' 学业预警系统 · 后台 Worker 已启动（无 HTTP 端口）');
  logger.log(` 通知派发开关 NOTIFICATION_DISPATCH_ENABLED=${process.env.NOTIFICATION_DISPATCH_ENABLED ?? '(默认 true)'}`);
  logger.log(` 预警队列消费 WARNING_QUEUE_CONSUMER_ENABLED=${process.env.WARNING_QUEUE_CONSUMER_ENABLED ?? '(默认 false)'}`);
  logger.log(` 兜底轮询间隔 ${getFallbackIntervalMs()}ms`);
  logger.log('==============================================');

  // 兜底轮询：调用已验证的 processNotificationJobs()
  // 动态 import 以免在 worker 未启用时影响 API 启动
  let running = false;
  const timer = setInterval(async () => {
    if (running) return; // 防止上一轮未结束就叠加
    running = true;
    try {
      const mod = await import('./workers/notification.worker');
      await mod.processNotificationJobs();
    } catch (error: any) {
      logger.error(`[Worker] 兜底通知处理失败: ${error?.message || error}`);
    } finally {
      running = false;
    }
  }, getFallbackIntervalMs());

  // 优雅退出：关闭 Nest 上下文并清理定时器
  const shutdown = async (signal: string) => {
    logger.log(`[Worker] 收到 ${signal}，正在优雅退出...`);
    clearInterval(timer);
    try {
      await app.close();
    } catch (error: any) {
      logger.error(`[Worker] 关闭应用上下文失败: ${error?.message || error}`);
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('========== WORKER BOOTSTRAP ERROR ==========');
  console.error(err?.stack || err);
  process.exit(1);
});
