import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import StripeConstructor = require('stripe');

interface PlanLimits {
  fiveHours: number;
  daily: number;
  weekly: number;
}

interface PricingPlan {
  id: 'free' | 'starter' | 'pro';
  name: string;
  tagline: string;
  priceMonthly: number;
  priceYearlyMonthly: number;
  currency: 'EUR';
  limits: PlanLimits;
  features: string[];
  recommended: boolean;
}

interface CheckoutPayload {
  userId: string;
  userEmail: string;
  planId: 'starter' | 'pro';
  billingCycle: 'monthly' | 'yearly';
}

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);
  private readonly stripe: StripeConstructor.Stripe | null;

  constructor(private config: ConfigService) {
    const stripeSecretKey = this.config.get<string>('STRIPE_SECRET_KEY');
    this.stripe = stripeSecretKey ? StripeConstructor(stripeSecretKey) : null;
  }

  getPlans() {
    const free: PricingPlan = {
      id: 'free',
      name: 'pricing.plan.free.name',
      tagline: 'pricing.plan.free.tagline',
      priceMonthly: 0,
      priceYearlyMonthly: 0,
      currency: 'EUR',
      limits: {
        fiveHours: this.readPositiveInt('AI_CREDITS_5H', 10),
        daily: this.readPositiveInt('AI_CREDITS_DAILY', 25),
        weekly: this.readPositiveInt('AI_CREDITS_WEEKLY', 120),
      },
      features: [
        'pricing.plan.free.features.allLevels',
        'pricing.plan.free.features.sourceGrounded',
        'pricing.plan.free.features.publicShare',
        'pricing.plan.free.features.community',
      ],
      recommended: false,
    };

    const starter: PricingPlan = {
      id: 'starter',
      name: 'pricing.plan.starter.name',
      tagline: 'pricing.plan.starter.tagline',
      priceMonthly: this.readPositiveInt('PRICE_STARTER_MONTHLY_EUR', 9),
      priceYearlyMonthly: this.readPositiveInt('PRICE_STARTER_YEARLY_MONTHLY_EUR', 7),
      currency: 'EUR',
      limits: {
        fiveHours: this.readPositiveInt('AI_CREDITS_5H_STARTER', 45),
        daily: this.readPositiveInt('AI_CREDITS_DAILY_STARTER', 180),
        weekly: this.readPositiveInt('AI_CREDITS_WEEKLY_STARTER', 800),
      },
      features: [
        'pricing.plan.starter.features.higherCaps',
        'pricing.plan.starter.features.fasterQueue',
        'pricing.plan.starter.features.favorites',
        'pricing.plan.starter.features.earlyAccess',
      ],
      recommended: true,
    };

    const pro: PricingPlan = {
      id: 'pro',
      name: 'pricing.plan.pro.name',
      tagline: 'pricing.plan.pro.tagline',
      priceMonthly: this.readPositiveInt('PRICE_PRO_MONTHLY_EUR', 29),
      priceYearlyMonthly: this.readPositiveInt('PRICE_PRO_YEARLY_MONTHLY_EUR', 24),
      currency: 'EUR',
      limits: {
        fiveHours: this.readPositiveInt('AI_CREDITS_5H_PRO', 140),
        daily: this.readPositiveInt('AI_CREDITS_DAILY_PRO', 600),
        weekly: this.readPositiveInt('AI_CREDITS_WEEKLY_PRO', 2500),
      },
      features: [
        'pricing.plan.pro.features.maxCaps',
        'pricing.plan.pro.features.fastestPriority',
        'pricing.plan.pro.features.teamWorkspace',
        'pricing.plan.pro.features.analytics',
      ],
      recommended: false,
    };

    return {
      paymentEnabled: this.arePaymentsEnabled(),
      plans: [free, starter, pro],
    };
  }

  async createCheckoutSession(payload: CheckoutPayload) {
    if (!this.arePaymentsEnabled() || !this.stripe) {
      throw new HttpException(
        {
          message:
            'Payments are not configured yet. Set Stripe keys and prices on the backend deployment.',
          code: 'PAYMENTS_NOT_CONFIGURED',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const priceId = this.getStripePriceId(payload.planId, payload.billingCycle);
    const frontendUrl = this.config.get<string>('FRONTEND_URL')?.trim();
    if (!frontendUrl) {
      throw new HttpException(
        {
          message: 'Missing FRONTEND_URL in backend environment variables.',
          code: 'MISSING_FRONTEND_URL',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const successUrl = `${frontendUrl.replace(/\/$/, '')}/pricing?checkout=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${frontendUrl.replace(/\/$/, '')}/pricing?checkout=cancel`;

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: payload.userEmail,
      client_reference_id: payload.userId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        userId: payload.userId,
        userEmail: payload.userEmail,
        planId: payload.planId,
        billingCycle: payload.billingCycle,
      },
    });

    if (!session.url) {
      throw new HttpException(
        {
          message: 'Stripe did not return a checkout URL.',
          code: 'MISSING_CHECKOUT_URL',
        },
        HttpStatus.BAD_GATEWAY,
      );
    }

    return { url: session.url };
  }

  handleWebhook(rawBody: Buffer | undefined, stripeSignature: string | undefined) {
    const webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET')?.trim();
    if (!this.stripe || !webhookSecret) {
      throw new HttpException(
        { message: 'Webhook is not configured.', code: 'WEBHOOK_NOT_CONFIGURED' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (!rawBody) {
      throw new HttpException(
        { message: 'Missing raw request body.', code: 'MISSING_RAW_BODY' },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!stripeSignature) {
      throw new HttpException(
        { message: 'Missing Stripe signature header.', code: 'MISSING_SIGNATURE' },
        HttpStatus.BAD_REQUEST,
      );
    }

    let event: any;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, stripeSignature, webhookSecret);
    } catch {
      throw new HttpException(
        { message: 'Invalid webhook signature.', code: 'INVALID_SIGNATURE' },
        HttpStatus.BAD_REQUEST,
      );
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as {
          id: string;
          metadata?: Record<string, string>;
        };
        this.logger.log(
          `Checkout completed: session=${session.id} user=${session.metadata?.userId ?? 'unknown'} plan=${session.metadata?.planId ?? 'unknown'}`,
        );
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'invoice.paid':
      case 'invoice.payment_failed':
        this.logger.log(`Stripe event received: ${event.type}`);
        break;
      default:
        this.logger.debug(`Unhandled Stripe event: ${event.type}`);
        break;
    }

    return { received: true };
  }

  private readPositiveInt(key: string, defaultValue: number) {
    const raw = this.config.get<string | number | undefined>(key);
    if (raw === undefined || raw === null || raw === '') {
      return defaultValue;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return defaultValue;
    }

    return Math.floor(parsed);
  }

  private arePaymentsEnabled() {
    return Boolean(
      this.config.get<string>('STRIPE_SECRET_KEY') &&
      this.config.get<string>('STRIPE_PRICE_STARTER_MONTHLY') &&
      this.config.get<string>('STRIPE_PRICE_STARTER_YEARLY') &&
      this.config.get<string>('STRIPE_PRICE_PRO_MONTHLY') &&
      this.config.get<string>('STRIPE_PRICE_PRO_YEARLY'),
    );
  }

  private getStripePriceId(
    planId: CheckoutPayload['planId'],
    billingCycle: CheckoutPayload['billingCycle'],
  ) {
    const key = `STRIPE_PRICE_${planId.toUpperCase()}_${billingCycle.toUpperCase()}`;
    const priceId = this.config.get<string>(key)?.trim();
    if (!priceId) {
      throw new HttpException(
        {
          message: `Missing Stripe price id for ${planId}/${billingCycle}.`,
          code: 'MISSING_PRICE_ID',
          env: key,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return priceId;
  }
}
