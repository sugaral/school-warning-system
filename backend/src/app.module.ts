import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { LoggerModule } from 'nestjs-pino';
import Redis from 'ioredis';

import { RedisModule } from './shared/redis.module';
import { IdempotencyModule } from './shared/idempotency.module';
import { ImportModule } from './shared/import.module';
import { MinioModule } from './shared/minio.module';
import { NotificationCenterModule } from './shared/notification-center.module';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './shared/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AttendanceModule } from './attendance/attendance.module';
import { WarningsModule } from './warnings/warnings.module';
import { RequestsModule } from './requests/requests.module';
import { JobsModule } from './jobs/jobs.module';
import { RulesModule } from './rules/rules.module';
import { StudentsModule } from './students/students.module';
import { ClassesModule } from './classes/classes.module';
import { OrgsModule } from './orgs/orgs.module';
import { TeachersModule } from './teachers/teachers.module';
import { CourseClassesModule } from './course-classes/course-classes.module';
import { WarningModule } from './warning/warning.module';
import { RbacModule } from './rbac/rbac.module';
import { UsersModule } from './users/users.module';
import { ReportsModule } from './reports/reports.module';
import { AuditModule } from './audit/audit.module';
import { StatsModule } from './stats/stats.module';
import { SystemConfigModule } from './config/config.module';
import { CoursesModule } from './courses/courses.module';
import { TeachingAdminModule } from './teaching-admin/teaching-admin.module';
import { StudentAdminModule } from './student-admin/student-admin.module';
import { TeacherModule } from './teacher/teacher.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { ViceDeanModule } from './vice-dean/vice-dean.module';
import { FilesController } from './files.controller';
import { TraceIdMiddleware } from './shared/traceid.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // 唯一配置源是仓库根目录的 .env（backend/.env 已废弃，避免两处不一致）。
      // 容器里由 compose 直接注入环境变量，这里的 ../.env 只对本地启动生效；
      // .env.local 仍可用于个人临时覆盖。
      envFilePath: ['.env.local', '.env', '../.env'],
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: false,
            translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
        level: process.env.LOG_LEVEL || 'info',
        // 禁用自动请求日志，只输出业务日志
        autoLogging: false,
      },
    }),
    RedisModule,
    IdempotencyModule,
    ImportModule,
    MinioModule,
    NotificationCenterModule,
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const jwtSecret = String(config.get<string>('JWT_SECRET') || '').trim();
        if (
          !jwtSecret ||
          jwtSecret === 'please-change-me' ||
          jwtSecret.includes('replace-with')
        ) {
          throw new Error(
            'JWT_SECRET is required and must be replaced before starting the backend.',
          );
        }

        return {
          secret: jwtSecret,
          signOptions: {
            expiresIn: (config.get<string>('JWT_EXPIRES_IN') || '7d') as any,
          },
        };
      },
    }),
    ThrottlerModule.forRootAsync({
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL', 'redis://127.0.0.1:6379');
        return {
          throttlers: [{ ttl: 60000, limit: 100 }],
          storage: new ThrottlerStorageRedisService(new Redis(redisUrl)),
        };
      },
      inject: [ConfigService],
    }),
    PrismaModule,
    RbacModule,
    AuthModule,
    AttendanceModule,
    WarningsModule,
    RequestsModule,
    JobsModule,
    RulesModule,
    StudentsModule,
    ClassesModule,
    OrgsModule,
    TeachersModule,
    CourseClassesModule,
    WarningModule,
    UsersModule,
    ReportsModule,
    AuditModule,
    StatsModule,
    SystemConfigModule,
    CoursesModule,
    TeachingAdminModule,
    StudentAdminModule,
    TeacherModule,
    ViceDeanModule,
    SchedulerModule,
  ],
  controllers: [HealthController, FilesController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TraceIdMiddleware).forRoutes('*');
  }
}
