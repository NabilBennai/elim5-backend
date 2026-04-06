import { Module } from '@nestjs/common';
import { ExplainController } from './explain.controller';
import { ExplainService } from './explain.service';
import { PublicExplainController } from './public-explain.controller';

@Module({
  controllers: [ExplainController, PublicExplainController],
  providers: [ExplainService],
})
export class ExplainModule {}
