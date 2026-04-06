import { Body, Controller, Get, HttpException, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

interface CheckoutRequestDto {
  planId: 'starter' | 'pro';
  billingCycle: 'monthly' | 'yearly';
}

@Controller('pricing')
export class PricingController {
  constructor(private pricingService: PricingService) {}

  @Get('plans')
  getPlans(): unknown {
    return this.pricingService.getPlans();
  }

  @UseGuards(JwtAuthGuard)
  @Post('checkout')
  createCheckout(@Body() body: CheckoutRequestDto): never {
    if (!['starter', 'pro'].includes(body.planId)) {
      throw new HttpException(
        { message: 'Invalid planId', code: 'INVALID_PLAN' },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!['monthly', 'yearly'].includes(body.billingCycle)) {
      throw new HttpException(
        { message: 'Invalid billingCycle', code: 'INVALID_BILLING_CYCLE' },
        HttpStatus.BAD_REQUEST,
      );
    }

    throw new HttpException(
      {
        message:
          'Payments are not enabled yet. Stripe checkout will be available in a future release.',
        code: 'PAYMENTS_NOT_ENABLED',
      },
      HttpStatus.NOT_IMPLEMENTED,
    );
  }
}
