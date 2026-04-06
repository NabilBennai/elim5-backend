import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const rawConnectionString = process.env.DATABASE_URL;

    if (!rawConnectionString) {
      throw new Error('DATABASE_URL is not defined');
    }

    const acceptSelfSignedCert = process.env.DB_SSL_REJECT_UNAUTHORIZED === 'false';
    const connectionUrl = new URL(rawConnectionString);

    if (acceptSelfSignedCert) {
      // Enables libpq-compatible semantics where sslmode=require does not enforce CA chain validation.
      connectionUrl.searchParams.set('uselibpqcompat', 'true');
      connectionUrl.searchParams.set('sslmode', 'require');
    } else {
      // Explicitly enforce certificate validation and silence pg's upcoming sslmode warning.
      connectionUrl.searchParams.set('sslmode', 'verify-full');
    }

    const adapter = new PrismaPg(connectionUrl.toString());

    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
