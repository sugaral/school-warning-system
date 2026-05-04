import { Global, Module } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { PrismaService } from './prisma.service';
import { RolesGuard } from './roles.guard';

@Global()
@Module({
  providers: [PrismaService, AuthGuard, RolesGuard],
  exports: [PrismaService, AuthGuard, RolesGuard],
})
export class PrismaModule {}
