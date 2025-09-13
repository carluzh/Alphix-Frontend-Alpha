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
    const { password, recaptchaToken, action } = await request.json();
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

    // Read fail counter cookie (HttpOnly) for gating (defense-in-depth with client-side gating)
    const cookieStore = await cookies();
    const failCookieRaw = cookieStore.get('login_fail_count')?.value;
    const failCount = Math.max(0, Math.min(100, Number(failCookieRaw || '0') || 0));

    // Progressive protection: captcha after 3 fails, runs continuously
    const needCaptcha = failCount >= 3;

    // If captcha is required, verify token server-side via Google (v3)
    if (needCaptcha) {
      try {
        const secret = process.env.RECAPTCHA_SECRET_KEY;
        if (!secret) throw new Error('Missing RECAPTCHA secret');
        if (!recaptchaToken) {
          return NextResponse.json({ message: 'Login failed.' }, { status: 400 });
        }
        const verifyRes = await fetch('https://www.google.com/recaptcha/api/siteverify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ secret, response: String(recaptchaToken) }),
        });
        const verifyJson: any = await verifyRes.json().catch(() => ({}));
        const ok = Boolean(verifyJson?.success);
        const scoreOk = typeof verifyJson?.score === 'number' ? verifyJson.score >= 0.5 : true; // v3 score threshold
        if (!(ok && scoreOk)) {
          return NextResponse.json({ message: 'Login failed.' }, { status: 400 });
        }
      } catch (e) {
        console.error('reCAPTCHA verify error:', e);
        return NextResponse.json({ message: 'Login failed.' }, { status: 400 });
      }
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
      // Reset fail counter
      response.cookies.set('login_fail_count', '0', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
      });
      // Reset IP gate
      ipGate.set(ip, { fails: 0, blockedUntil: 0, last: nowTs });
      return response;
    } else {
      // Increment fail counter
      const nextFail = Math.min(failCount + 1, 100);
      const response = NextResponse.json({ message: 'Login failed.' }, { status: 401 });
      response.cookies.set('login_fail_count', String(nextFail), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
      });
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