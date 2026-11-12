import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const isProduction = process.env.NODE_ENV === 'production';
  const origins = (process.env.FRONTEND_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (isProduction) {
    const required = ['OIDC_ISSUER', 'OIDC_AUDIENCE', 'OIDC_JWKS_URL', 'DATABASE_URL'];
    const missing = required.filter((name) => !process.env[name]?.trim());
    if (missing.length) throw new Error(`Missing required production configuration: ${missing.join(', ')}`);
    if (process.env.AUTH_BYPASS_DEV !== 'false') throw new Error('Set AUTH_BYPASS_DEV=false in production.');
    if (process.env.MOCK_LLM !== 'false') throw new Error('MOCK_LLM=false is required in production.');
    if (!process.env.OPENAI_API_KEY?.trim()) throw new Error('OPENAI_API_KEY is required when MOCK_LLM=false.');
    if (process.env.DATABASE_SSL !== 'true') throw new Error('DATABASE_SSL=true is required in production.');
    const hasInvalidOrigin = origins.length === 0 || origins.some((origin) => {
      try {
        const parsed = new URL(origin);
        return parsed.protocol !== 'https:' || parsed.origin !== origin;
      } catch {
        return true;
      }
    });
    if (hasInvalidOrigin) {
      throw new Error('Production FRONTEND_ORIGINS must be exact HTTPS origins without paths.');
    }
    for (const name of ['OIDC_ISSUER', 'OIDC_JWKS_URL']) {
      let parsed: URL;
      try {
        parsed = new URL(process.env[name]!);
      } catch {
        throw new Error(`${name} must be a valid HTTPS URL.`);
      }
      if (parsed.protocol !== 'https:') throw new Error(`${name} must use HTTPS in production.`);
    }
    if (!Number.isInteger(Number(process.env.RATE_LIMIT_MAX ?? 30)) || Number(process.env.RATE_LIMIT_MAX ?? 30) < 1) {
      throw new Error('RATE_LIMIT_MAX must be a positive integer.');
    }
    const userLimit = Number(process.env.USER_RATE_LIMIT_MAX ?? 30);
    const userWindow = Number(process.env.USER_RATE_LIMIT_WINDOW_MS ?? 60_000);
    if (!Number.isInteger(userLimit) || userLimit < 1 || userLimit > 10_000
      || !Number.isInteger(userWindow) || userWindow < 1_000 || userWindow > 3_600_000) {
      throw new Error('USER_RATE_LIMIT_MAX or USER_RATE_LIMIT_WINDOW_MS is outside the supported range.');
    }
    const poolMax = Number(process.env.DATABASE_POOL_MAX ?? 10);
    if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 100) {
      throw new Error('DATABASE_POOL_MAX must be between 1 and 100.');
    }
    const statementTimeout = Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS ?? 5_000);
    const queryTimeout = Number(process.env.DATABASE_QUERY_TIMEOUT_MS ?? 7_000);
    if (!Number.isInteger(statementTimeout) || statementTimeout < 500 || statementTimeout > 60_000
      || !Number.isInteger(queryTimeout) || queryTimeout <= statementTimeout || queryTimeout > 65_000) {
      throw new Error('Database query timeouts are invalid; query timeout must exceed statement timeout.');
    }
  }

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: true,
      bodyLimit: 16 * 1024,
      trustProxy: false,
      requestIdHeader: false,
      genReqId: () => randomUUID(),
    }),
  );

  app.getHttpAdapter().getInstance().addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Request-ID', request.id);
    reply.header('Cache-Control', 'no-store');
    return payload;
  });

  app.enableCors({
    origin: origins,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    credentials: false,
    maxAge: 600,
  });

  await app.register(helmet, { global: true });
  await app.register(rateLimit, {
    global: true,
    max: Number(process.env.RATE_LIMIT_MAX ?? 30),
    timeWindow: process.env.RATE_LIMIT_WINDOW ?? '1 minute',
  });

  app.setGlobalPrefix('api');

  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? (isProduction ? '0.0.0.0' : '127.0.0.1');
  await app.listen(port, host);
}

void bootstrap();
