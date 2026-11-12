import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  readonly enabled: boolean;

  constructor(@Inject(ConfigService) config: ConfigService) {
    const connectionString = config.get<string>('DATABASE_URL')?.trim();
    const url = new URL(connectionString || 'postgresql://localhost:5432/bulls_media');
    url.searchParams.set('connection_limit', config.get<string>('DATABASE_POOL_MAX', '10'));
    url.searchParams.set('connect_timeout', '5');
    url.searchParams.set('pool_timeout', '7');
    url.searchParams.set('socket_timeout', String(Math.ceil(Number(config.get<string>('DATABASE_QUERY_TIMEOUT_MS', '7000')) / 1000)));

    if (config.get<string>('DATABASE_SSL') === 'true') {
      url.searchParams.set('sslmode', 'verify-full');
    }

    const statementTimeout = Number(config.get<string>('DATABASE_STATEMENT_TIMEOUT_MS', '5000'));
    const existingOptions = url.searchParams.get('options');
    url.searchParams.set(
      'options',
      [existingOptions, `-c statement_timeout=${statementTimeout}`].filter(Boolean).join(' '),
    );

    super({ datasources: { db: { url: url.toString() } } });
    this.enabled = Boolean(connectionString);
  }

  async onModuleInit(): Promise<void> {
    if (this.enabled) await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.enabled) await this.$disconnect();
  }
}
