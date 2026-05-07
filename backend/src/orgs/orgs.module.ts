import { Module } from '@nestjs/common';
import { OrgsController } from './orgs.controller';

@Module({
  controllers: [OrgsController],
  providers: [],
})
export class OrgsModule {}
