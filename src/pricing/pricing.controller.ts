import { Body, Controller, Get, Headers, Post, Req, UseGuards } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { Request } from 'express';
import { PricingService } from './pricing.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    email: string;
  };
  rawBody?: Buffer;
}

class CheckoutRequestDto {
  @IsIn(['starter', 'pro'])
  planId: 'starter' | 'pro';

  @IsIn(['monthly', 'yearly'])
  billingCycle: 'monthly' | 'yearly';
}

@Controller()
export class PricingController {
  constructor(private pricingService: PricingService) {}

  @Get('pricing/plans')
  getPlans(): unknown {
    return this.pricingService.getPlans();
  }

  @UseGuards(JwtAuthGuard)
  @Get('pricing/subscription')
  getCurrentSubscription(@Req() req: AuthenticatedRequest) {
    return this.pricingService.getCurrentSubscription(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('pricing/checkout')
  createCheckout(@Body() body: CheckoutRequestDto, @Req() req: AuthenticatedRequest) {
    return this.pricingService.createCheckoutSession({
      userId: req.user.id,
      userEmail: req.user.email,
      planId: body.planId,
      billingCycle: body.billingCycle,
    });
  }

  @Post('stripe/webhook')
  handleStripeWebhook(
    @Req() req: AuthenticatedRequest,
    @Headers('stripe-signature') stripeSignature: string | undefined,
  ) {
    return this.pricingService.handleWebhook(req.rawBody, stripeSignature);
  }
}
