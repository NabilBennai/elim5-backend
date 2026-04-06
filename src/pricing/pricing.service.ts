import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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

@Injectable()
export class PricingService {
  constructor(private config: ConfigService) {}

  getPlans() {
    const free: PricingPlan = {
      id: 'free',
      name: 'Free',
      tagline: 'Best for trying ELI5',
      priceMonthly: 0,
      priceYearlyMonthly: 0,
      currency: 'EUR',
      limits: {
        fiveHours: this.readPositiveInt('AI_CREDITS_5H', 10),
        daily: this.readPositiveInt('AI_CREDITS_DAILY', 25),
        weekly: this.readPositiveInt('AI_CREDITS_WEEKLY', 120),
      },
      features: [
        'All explanation levels',
        'Source-grounded explanations',
        'Public share pages',
        'Community support',
      ],
      recommended: false,
    };

    const starter: PricingPlan = {
      id: 'starter',
      name: 'Starter',
      tagline: 'For regular learners and students',
      priceMonthly: this.readPositiveInt('PRICE_STARTER_MONTHLY_EUR', 9),
      priceYearlyMonthly: this.readPositiveInt('PRICE_STARTER_YEARLY_MONTHLY_EUR', 7),
      currency: 'EUR',
      limits: {
        fiveHours: this.readPositiveInt('AI_CREDITS_5H_STARTER', 45),
        daily: this.readPositiveInt('AI_CREDITS_DAILY_STARTER', 180),
        weekly: this.readPositiveInt('AI_CREDITS_WEEKLY_STARTER', 800),
      },
      features: [
        'Higher credit caps',
        'Faster generation queue',
        'Save favorite explanations',
        'Early feature access',
      ],
      recommended: true,
    };

    const pro: PricingPlan = {
      id: 'pro',
      name: 'Pro',
      tagline: 'For power users and teams',
      priceMonthly: this.readPositiveInt('PRICE_PRO_MONTHLY_EUR', 29),
      priceYearlyMonthly: this.readPositiveInt('PRICE_PRO_YEARLY_MONTHLY_EUR', 24),
      currency: 'EUR',
      limits: {
        fiveHours: this.readPositiveInt('AI_CREDITS_5H_PRO', 140),
        daily: this.readPositiveInt('AI_CREDITS_DAILY_PRO', 600),
        weekly: this.readPositiveInt('AI_CREDITS_WEEKLY_PRO', 2500),
      },
      features: [
        'Maximum credit caps',
        'Fastest generation priority',
        'Team workspace (coming soon)',
        'Advanced usage analytics',
      ],
      recommended: false,
    };

    return {
      paymentEnabled: false,
      plans: [free, starter, pro],
    };
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
}
