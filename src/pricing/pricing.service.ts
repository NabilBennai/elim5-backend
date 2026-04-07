import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import StripeConstructor = require('stripe');
import { PrismaService } from '../prisma/prisma.service';

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

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
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

  async getCurrentSubscription(userId: string) {
    const current = await this.prisma.billingSubscription.findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });

    if (!current) {
      return {
        isActive: false,
        planId: 'free',
        billingCycle: 'monthly',
        status: 'inactive',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
      };
    }

    return {
      isActive: ['active', 'trialing', 'past_due'].includes(current.status),
      planId: current.planId,
      billingCycle: current.billingCycle,
      status: current.status,
      cancelAtPeriodEnd: current.cancelAtPeriodEnd,
      currentPeriodEnd: current.currentPeriodEnd,
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
    const frontendUrl = this.getFrontendUrl();

    const successUrl = `${frontendUrl}/pricing?checkout=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${frontendUrl}/pricing?checkout=cancel`;

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

  async handleWebhook(rawBody: Buffer | undefined, stripeSignature: string | undefined) {
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
        await this.handleCheckoutCompleted(event.data.object as any);
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await this.handleSubscriptionChanged(event.data.object as any);
        break;
      }
      case 'invoice.paid':
      case 'invoice.payment_failed': {
        await this.handleInvoiceEvent(event.data.object as any);
        break;
      }
      default:
        this.logger.debug(`Unhandled Stripe event: ${event.type}`);
        break;
    }

    return { received: true };
  }

  private async handleCheckoutCompleted(session: any) {
    const userId = session.client_reference_id || session.metadata?.userId;
    const customerId = this.extractId(session.customer);
    const subscriptionId = this.extractId(session.subscription);

    if (userId && customerId) {
      await this.prisma.user.updateMany({
        where: { id: userId },
        data: { stripeCustomerId: customerId },
      });
    }

    if (!subscriptionId) {
      this.logger.warn(`checkout.session.completed without subscription id: session=${session.id}`);
      return;
    }

    await this.syncSubscriptionFromStripe(subscriptionId, userId || undefined);
  }

  private async handleSubscriptionChanged(subscription: any) {
    const subscriptionId = this.extractId(subscription.id);
    if (!subscriptionId) {
      this.logger.warn('customer.subscription.* received without subscription id');
      return;
    }

    await this.syncSubscriptionFromStripe(subscriptionId);
  }

  private async handleInvoiceEvent(invoice: any) {
    const subscriptionId = this.extractId(invoice.subscription);
    if (!subscriptionId) {
      this.logger.warn(`invoice event without subscription id: invoice=${invoice.id}`);
      return;
    }

    await this.prisma.billingSubscription.updateMany({
      where: { stripeSubscriptionId: subscriptionId },
      data: {
        lastInvoiceStatus: String(invoice.status || ''),
      },
    });
  }

  private async syncSubscriptionFromStripe(subscriptionId: string, userIdHint?: string) {
    if (!this.stripe) return;

    const subscription = (await this.stripe.subscriptions.retrieve(subscriptionId)) as any;
    const customerId = this.extractId(subscription.customer);

    let userId = userIdHint;

    if (!userId && customerId) {
      const userByCustomer = await this.prisma.user.findUnique({
        where: { stripeCustomerId: customerId },
        select: { id: true },
      });
      userId = userByCustomer?.id;
    }

    if (!userId) {
      const existing = await this.prisma.billingSubscription.findUnique({
        where: { stripeSubscriptionId: subscriptionId },
        select: { userId: true },
      });
      userId = existing?.userId;
    }

    if (!userId) {
      this.logger.warn(
        `Unable to map Stripe subscription to user: subscription=${subscriptionId} customer=${customerId || 'unknown'}`,
      );
      return;
    }

    if (customerId) {
      await this.prisma.user.updateMany({
        where: { id: userId },
        data: { stripeCustomerId: customerId },
      });
    }

    const firstPriceId = this.extractId(subscription.items?.data?.[0]?.price?.id);
    const planId = this.resolvePlanFromPriceId(firstPriceId);
    const billingCycle = this.resolveBillingFromPriceId(firstPriceId);

    await this.prisma.billingSubscription.upsert({
      where: { stripeSubscriptionId: String(subscription.id) },
      create: {
        userId,
        stripeSubscriptionId: String(subscription.id),
        stripeCustomerId: customerId || '',
        planId,
        billingCycle,
        status: String(subscription.status),
        cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
        currentPeriodStart: this.fromUnix(subscription.current_period_start),
        currentPeriodEnd: this.fromUnix(subscription.current_period_end),
        lastInvoiceStatus: null,
      },
      update: {
        stripeCustomerId: customerId || '',
        planId,
        billingCycle,
        status: String(subscription.status),
        cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
        currentPeriodStart: this.fromUnix(subscription.current_period_start),
        currentPeriodEnd: this.fromUnix(subscription.current_period_end),
      },
    });
  }

  private extractId(value: unknown): string | null {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value !== null && 'id' in value) {
      const id = (value as { id?: unknown }).id;
      return typeof id === 'string' ? id : null;
    }
    return null;
  }

  private fromUnix(value: unknown): Date | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
    return new Date(value * 1000);
  }

  private resolvePlanFromPriceId(priceId: string | null) {
    if (!priceId) return 'free';
    const map = this.getPriceIdMap();
    if (priceId === map.starterMonthly || priceId === map.starterYearly) return 'starter';
    if (priceId === map.proMonthly || priceId === map.proYearly) return 'pro';
    return 'free';
  }

  private resolveBillingFromPriceId(priceId: string | null): 'monthly' | 'yearly' {
    if (!priceId) return 'monthly';
    const map = this.getPriceIdMap();
    if (priceId === map.starterYearly || priceId === map.proYearly) return 'yearly';
    return 'monthly';
  }

  private getPriceIdMap() {
    return {
      starterMonthly: this.config.get<string>('STRIPE_PRICE_STARTER_MONTHLY')?.trim() || '',
      starterYearly: this.config.get<string>('STRIPE_PRICE_STARTER_YEARLY')?.trim() || '',
      proMonthly: this.config.get<string>('STRIPE_PRICE_PRO_MONTHLY')?.trim() || '',
      proYearly: this.config.get<string>('STRIPE_PRICE_PRO_YEARLY')?.trim() || '',
    };
  }

  private getFrontendUrl() {
    const raw = this.config.get<string>('FRONTEND_URL')?.trim();
    if (!raw) {
      throw new HttpException(
        {
          message: 'Missing FRONTEND_URL in backend environment variables.',
          code: 'MISSING_FRONTEND_URL',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return raw.replace(/\.+$/, '').replace(/\/$/, '');
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
