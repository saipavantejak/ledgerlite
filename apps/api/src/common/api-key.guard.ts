import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

/** Dev-grade shared secret. Off when API_KEY is unset/empty. /health is always open. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const expected = process.env.API_KEY;
    if (!expected) return true;
    const req = ctx.switchToHttp().getRequest<{ method: string; path: string; headers: Record<string, string | undefined> }>();
    if (req.method === 'OPTIONS' || req.path === '/health') return true;
    const got = Buffer.from(req.headers['x-api-key'] ?? '');
    const want = Buffer.from(expected);
    if (got.length !== want.length || !timingSafeEqual(got, want)) throw new UnauthorizedException('invalid API key');
    return true;
  }
}
