import { Module } from '@nestjs/common';
import { ExplainController } from './explain.controller';
import { ExplainService } from './explain.service';

@Module({
  controllers: [ExplainController],
  providers: [ExplainService],
})
export class ExplainModule {}
