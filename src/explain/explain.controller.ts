import { Controller, Post, Get, Body, UseGuards, Request } from '@nestjs/common';
import { ExplainService } from './explain.service';
import { CreateExplanationDto } from './explain.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('explain')
export class ExplainController {
  constructor(private explain: ExplainService) {}

  @Post()
  create(
    @Body() dto: CreateExplanationDto,
    @Request() req: { user: { id: string } },
  ) {
    return this.explain.create(dto, req.user.id);
  }

  @Get('history')
  history(@Request() req: { user: { id: string } }) {
    return this.explain.findAllByUser(req.user.id);
  }
}
