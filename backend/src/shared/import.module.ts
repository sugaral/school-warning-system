import { Global, Module } from '@nestjs/common';
import { ImportService } from './import.service';

/**
 * 通用导入模块（P1-8）
 *
 * 设为 @Global，使各业务 controller（courses / schedules / students ...）
 * 无需重复 import 即可注入 ImportService。
 */
@Global()
@Module({
  providers: [ImportService],
  exports: [ImportService],
})
export class ImportModule {}
