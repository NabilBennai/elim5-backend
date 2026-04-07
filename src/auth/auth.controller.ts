import { Controller, Post, Get, Body, UseGuards, Request, Patch } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto, RegisterDto } from './auth.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Request() req: { user: { id: string; email: string; createdAt: Date } }) {
    return req.user;
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me/password')
  changePassword(@Request() req: { user: { id: string } }, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(req.user.id, dto);
  }
}
