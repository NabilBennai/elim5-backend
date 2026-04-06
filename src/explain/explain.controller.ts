import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { ExplainService } from './explain.service';
import { CreateExplanationDto } from './explain.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('explain')
export class ExplainController {
  constructor(private explain: ExplainService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreateExplanationDto, @Request() req: { user: { id: string } }) {
    return this.explain.create(dto, req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('history')
  history(@Request() req: { user: { id: string } }) {
    return this.explain.findAllByUser(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('credits')
  credits(@Request() req: { user: { id: string } }): Promise<unknown> {
    return this.explain.getCredits(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/share')
  share(@Param('id') id: string, @Request() req: { user: { id: string } }) {
    return this.explain.createShare(id, req.user.id);
  }
}
