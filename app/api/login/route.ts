import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';

/**
 * Login API Route
 *
 * NOTE: This login system will be deprecated soon.
 * Rate limiting now uses Redis (Upstash) for serverless persistence.
 *
 * In-memory rate limiting removed - ineffective in serverless environments.
 * @see interface/packages/utilities/src/react/useThrottledCallback.tsx (Uniswap uses client-side throttling)
 */

// Redis key prefix for login rate limiting
const RATE_LIMIT_PREFIX = 'rate-limit:login:';
const RATE_LIMIT_TTL_SECONDS = 60; // 1 minute TTL for rate limit state

// Cooldown schedule: 0s, 2s, 5s, 10s, 20s (cap)
const COOLDOWN_SCHEDULE_MS = [0, 2000, 5000, 10000, 20000];

type IpState = { fails: number; blockedUntil: number };

function getClientIp(request: Request): string {
  const xf = request.headers.get('x-forwarded-for');
  if (xf && xf.length > 0) return xf.split(',')[0].trim();
  const xr = request.headers.get('x-real-ip');
  if (xr) return xr;
  const cf = request.headers.get('cf-connecting-ip');
  if (cf) return cf;
  return 'unknown';
}

async function getRateLimitState(ip: string): Promise<IpState> {
  if (!redis) {
    // If Redis not configured, allow request (graceful degradation)
    return { fails: 0, blockedUntil: 0 };
  }

  try {
    const state = await redis.get<IpState>(`${RATE_LIMIT_PREFIX}${ip}`);
    return state || { fails: 0, blockedUntil: 0 };
  } catch (error) {
    console.error('[Login] Redis get failed:', error);
    return { fails: 0, blockedUntil: 0 };
  }
}

async function setRateLimitState(ip: string, state: IpState): Promise<void> {
  if (!redis) return;

  try {
    await redis.setex(`${RATE_LIMIT_PREFIX}${ip}`, RATE_LIMIT_TTL_SECONDS, state);
  } catch (error) {
    console.error('[Login] Redis set failed:', error);
  }
}

async function clearRateLimitState(ip: string): Promise<void> {
  if (!redis) return;

  try {
    await redis.del(`${RATE_LIMIT_PREFIX}${ip}`);
  } catch (error) {
    console.error('[Login] Redis delete failed:', error);
  }
}

export async function POST(request: Request) {
  try {
    const { password } = await request.json();
    if (!password) {
      return NextResponse.json({ message: 'Login failed.' }, { status: 400 });
    }

    // IP-based rate limiting using Redis (serverless-safe)
    const ip = getClientIp(request);
    const nowTs = Date.now();
    const ipState = await getRateLimitState(ip);

    if (ipState.blockedUntil && nowTs < ipState.blockedUntil) {
      return NextResponse.json({ message: 'Login failed.' }, { status: 429 });
    }

    const allowedPasswords = [
      process.env.SITE_PASSWORD,
      process.env.ADMIN_PASSWORD,
      process.env.MISC_PASSWORD_1,
      process.env.MISC_PASSWORD_2,
      process.env.MISC_PASSWORD_3,
    ].filter(Boolean) as string[];

    if (allowedPasswords.length === 0) {
      console.error('No login passwords configured via env.');
      return NextResponse.json({ message: 'Login failed.' }, { status: 400 });
    }

    const isValid = allowedPasswords.some((p) => p === password);

    if (isValid) {
      const response = NextResponse.json({ message: 'Login successful' }, { status: 200 });

      // Calculate expiry for end of current day (UTC)
      const now = new Date();
      const endOfDay = new Date(now);
      endOfDay.setUTCHours(23, 59, 59, 999);

      response.cookies.set('site_auth_token', 'valid', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        expires: endOfDay,
      });

      // Clear rate limit state on successful login
      await clearRateLimitState(ip);
      return response;
    } else {
      const response = NextResponse.json({ message: 'Login failed.' }, { status: 401 });

      // Update rate limit state with cooldown
      const fails = (ipState.fails || 0) + 1;
      const idx = Math.min(COOLDOWN_SCHEDULE_MS.length - 1, Math.max(0, fails - 1));
      const blockedUntil = nowTs + COOLDOWN_SCHEDULE_MS[idx];

      await setRateLimitState(ip, { fails, blockedUntil });
      return response;
    }
  } catch (error) {
    console.error('Login API error:', error);
    return NextResponse.json({ message: 'Login failed.' }, { status: 400 });
  }
} 