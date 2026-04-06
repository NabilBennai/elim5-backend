import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreatePublicCommentDto } from './explain.dto';
import { ExplainService } from './explain.service';

@Controller('public')
export class PublicExplainController {
  constructor(private explain: ExplainService) {}

  @Get(':shareId')
  getShared(@Param('shareId') shareId: string) {
    return this.explain.getSharedExplanation(shareId);
  }

  @Post(':shareId/comments')
  addComment(@Param('shareId') shareId: string, @Body() dto: CreatePublicCommentDto) {
    return this.explain.addPublicComment(shareId, dto);
  }
}
