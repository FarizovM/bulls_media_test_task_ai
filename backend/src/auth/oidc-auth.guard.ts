import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
  SetMetadata,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export const REQUIRED_SCOPE = 'requiredScope';
export const RequireScope = (scope: string) => SetMetadata(REQUIRED_SCOPE, scope);

@Injectable()
export class OidcAuthGuard implements CanActivate {
  private jwks?: ReturnType<typeof createRemoteJWKSet>;
  private readonly subjectLimits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; user?: unknown }>();
    const isProduction = this.config.get<string>('NODE_ENV') === 'production';
    const allowDevBypass = this.config.get<string>('AUTH_BYPASS_DEV', 'true') === 'true';
    if (!isProduction && allowDevBypass) {
      request.user = { sub: 'local-developer', scope: 'agent:read agent:triage' };
      return true;
    }

    const issuer = this.config.get<string>('OIDC_ISSUER')?.trim();
    const audience = this.config.get<string>('OIDC_AUDIENCE')?.trim();
    const jwksUrl = this.config.get<string>('OIDC_JWKS_URL')?.trim();
    if (!issuer || !audience || !jwksUrl) {
      throw new UnauthorizedException('Authentication is not configured.');
    }

    const authorization = request.headers.authorization;
    const match = authorization?.match(/^Bearer ([^\s]+)$/i);
    if (!match) throw new UnauthorizedException('A valid bearer token is required.');

    try {
      const jwks = this.jwks ??= createRemoteJWKSet(new URL(jwksUrl), {
        timeoutDuration: 5_000,
        cooldownDuration: 30_000,
        cacheMaxAge: 10 * 60_000,
      });
      const { payload } = await jwtVerify(match[1], jwks, {
        issuer,
        audience,
        algorithms: ['RS256', 'PS256', 'ES256'],
        clockTolerance: 5,
      });
      if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255) {
        throw new UnauthorizedException('The access token has no subject.');
      }
      request.user = { sub: payload.sub, scope: payload.scope, scp: payload.scp };

      const requiredScope = this.reflector.getAllAndOverride<string>(REQUIRED_SCOPE, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (requiredScope) {
        const scopes = [
          ...(typeof payload.scope === 'string' ? payload.scope.split(/\s+/) : []),
          ...(typeof payload.scp === 'string' ? payload.scp.split(/\s+/) : []),
          ...(Array.isArray(payload.scp) ? payload.scp.filter((value): value is string => typeof value === 'string') : []),
        ];
        if (!scopes.includes(requiredScope)) throw new ForbiddenException('The required permission is missing.');
      }
      this.consumeSubjectLimit(payload.sub);
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException || (error instanceof HttpException && error.getStatus() === HttpStatus.TOO_MANY_REQUESTS)) throw error;
      throw new UnauthorizedException('The access token is invalid or expired.');
    }
  }

  private consumeSubjectLimit(subject: string): void {
    const now = Date.now();
    const max = Number(this.config.get<string>('USER_RATE_LIMIT_MAX', '30'));
    const windowMs = Number(this.config.get<string>('USER_RATE_LIMIT_WINDOW_MS', '60000'));
    let bucket = this.subjectLimits.get(subject);
    if (!bucket || bucket.resetAt <= now) {
      if (this.subjectLimits.size >= 10_000) {
        for (const [key, value] of this.subjectLimits) {
          if (value.resetAt <= now) this.subjectLimits.delete(key);
        }
      }
      if (this.subjectLimits.size >= 10_000) throw new HttpException('The service is temporarily busy.', HttpStatus.TOO_MANY_REQUESTS);
      bucket = { count: 0, resetAt: now + windowMs };
      this.subjectLimits.set(subject, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) throw new HttpException('Rate limit exceeded.', HttpStatus.TOO_MANY_REQUESTS);
  }
}
