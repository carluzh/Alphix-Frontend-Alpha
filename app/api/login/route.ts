import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

// Lightweight in-memory IP gate (best-effort; not persistent across cold starts)
type IpState = { fails: number; blockedUntil: number; last: number };
const ipGate = new Map<string, IpState>();

function getClientIp(request: Request): string {
  const xf = request.headers.get('x-forwarded-for');
  if (xf && xf.length > 0) return xf.split(',')[0].trim();
  const xr = request.headers.get('x-real-ip');
  if (xr) return xr;
  // As a last resort, try CF-Connecting-IP
  const cf = request.headers.get('cf-connecting-ip');
  if (cf) return cf;
  return 'unknown';
}

export async function POST(request: Request) {
  try {
    const { password } = await request.json();
    if (!password) {
      // Generic message to avoid leaking signal
      return NextResponse.json({ message: 'Login failed.' }, { status: 400 });
    }

    // IP gate: short cooldowns after repeated failures
    const ip = getClientIp(request);
    const nowTs = Date.now();
    const ipState = ipGate.get(ip) || { fails: 0, blockedUntil: 0, last: 0 };
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
      // Reset IP gate
      ipGate.set(ip, { fails: 0, blockedUntil: 0, last: nowTs });
      return response;
    } else {
      const response = NextResponse.json({ message: 'Login failed.' }, { status: 401 });
      // Update IP gate with cooldowns
      const fails = (ipState.fails || 0) + 1;
      // cooldown schedule: 0s, 2s, 5s, 10s, 20s (cap)
      const schedule = [0, 2000, 5000, 10000, 20000];
      const idx = Math.min(schedule.length - 1, Math.max(0, fails - 1));
      const blockedUntil = nowTs + schedule[idx];
      ipGate.set(ip, { fails, blockedUntil, last: nowTs });
      return response;
    }
  } catch (error) {
    console.error('Login API error:', error);
    return NextResponse.json({ message: 'Login failed.' }, { status: 400 });
  }
} 