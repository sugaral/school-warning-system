import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PermissionService } from './permission.service';
import { PermissionController } from './permission.controller';
import { RoleController } from './role.controller';
import { PermissionGuard } from './permission.guard';
import { DataScopeInterceptor } from './data-scope.interceptor';

@Global()
@Module({
  providers: [
    PermissionService,
    PermissionGuard,
    DataScopeInterceptor,
    {
      provide: APP_INTERCEPTOR,
      useExisting: DataScopeInterceptor,
    },
  ],
  controllers: [PermissionController, RoleController],
  exports: [PermissionService, PermissionGuard, DataScopeInterceptor],
})
export class RbacModule {}
