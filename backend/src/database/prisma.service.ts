import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  readonly enabled: boolean;
  private readonly pool?: Pool;

  constructor(@Inject(ConfigService) config: ConfigService) {
    const connectionString = config.get<string>('DATABASE_URL')?.trim();

    if (connectionString) {
      const maxPool = Number(config.get<string>('DATABASE_POOL_MAX', '10'));
      const statementTimeout = Number(config.get<string>('DATABASE_STATEMENT_TIMEOUT_MS', '5000'));
      const queryTimeout = Number(config.get<string>('DATABASE_QUERY_TIMEOUT_MS', '7000'));
      const isSsl = config.get<string>('DATABASE_SSL') === 'true';

      const pool = new Pool({
        connectionString,
        max: maxPool,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 7000,
        statement_timeout: statementTimeout,
        query_timeout: queryTimeout,
        ssl: isSsl ? { rejectUnauthorized: true } : undefined,
      });

      const adapter = new PrismaPg(pool);
      super({ adapter });
      this.pool = pool;
      this.enabled = true;
    } else {
      super();
      this.enabled = false;
    }
  }

  async onModuleInit(): Promise<void> {
    if (this.enabled) await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.enabled) {
      await this.$disconnect();
      await this.pool?.end();
    }
  }
}
