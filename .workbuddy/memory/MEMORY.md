# MEMORY.md - 项目长期记忆

## 项目概况
- **项目名**: WarnSys（学生预警系统）
- **技术栈**: NestJS + Prisma + MySQL + Redis，前端 Vue3 + Element Plus
- **部署方式**: Docker Compose，服务器路径 /www/wwwroot/warnsys
- **域名**: xueyeyujing.asia
- **数据库**: MySQL 8.0，连接 warnuser/127.0.0.1，Prisma 连接池默认 30
- **服务架构**: backend (NestJS) + frontend (Nginx+Vue) + MySQL + Redis + MinIO

## 关键架构
- **认证**: JWT + AuthGuard（查 Redis 黑名单 + users 表）+ PermissionGuard/RolesGuard
- **全局拦截器**: AuditInterceptor（审计日志）、AdminResponseCacheInterceptor（管理端响应缓存）、ResponseInterceptor、DataScopeInterceptor
- **中间件**: TraceIdMiddleware
- **签到结束流程**: Redis 分布式锁 → 查课次+学生 → 查请假 → 事务写入 → 异步预警入队
- **预警队列**: WarningQueueService，Redis Stream 实现，消费者并发度 4

## 已知问题与修复
- 2026-04-23: 修复 wxCode 复用导致的 openid 绑定错误
- 2026-04-23: 排查"结束签到"操作延迟问题，加了 Guard 层性能诊断日志

## 部署约定
- 服务器无 Node.js，前端需本地构建后上传
- 部署脚本: deploy-all.sh / deploy-backend.sh / deploy.sh
