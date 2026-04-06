import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

type DbSslMode = 'disable' | 'require' | 'verify-full';

function resolveSslMode(url: URL): DbSslMode {
  const configuredMode = process.env.DB_SSL_MODE as DbSslMode | undefined;
  if (configuredMode) {
    return configuredMode;
  }

  // Local Postgres usually runs without TLS.
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    return 'disable';
  }

  const acceptSelfSignedCert = process.env.DB_SSL_REJECT_UNAUTHORIZED === 'false';
  return acceptSelfSignedCert ? 'require' : 'verify-full';
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const rawConnectionString = process.env.DATABASE_URL;

    if (!rawConnectionString) {
      throw new Error('DATABASE_URL is not defined');
    }

    const connectionUrl = new URL(rawConnectionString);
    const sslMode = resolveSslMode(connectionUrl);

    if (sslMode === 'disable') {
      connectionUrl.searchParams.delete('sslmode');
      connectionUrl.searchParams.delete('uselibpqcompat');
    } else if (sslMode === 'require') {
      // Enables libpq-compatible semantics where sslmode=require does not enforce CA chain validation.
      connectionUrl.searchParams.set('uselibpqcompat', 'true');
      connectionUrl.searchParams.set('sslmode', 'require');
    } else {
      // Explicitly enforce certificate validation and silence pg's upcoming sslmode warning.
      connectionUrl.searchParams.delete('uselibpqcompat');
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
