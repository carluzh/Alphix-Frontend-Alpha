import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
// import { cookies } from 'next/headers'; // Not used in Middleware for reading cookies

export function middleware(request: NextRequest) {
  // Bypass auth for E2E tests (check for query parameter)
  if (request.nextUrl.searchParams.get('e2e') === 'true') {
    console.log('[MIDDLEWARE] E2E test detected - bypassing auth checks');
    return NextResponse.next();
  }

  // Handle CORS preflight universally to avoid 400s from OPTIONS
  if (request.method === 'OPTIONS') {
    const res = new NextResponse(null, { status: 204 });
    const origin = request.headers.get('origin') || '*';
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Vary', 'Origin');
    res.headers.set('Access-Control-Allow-Credentials', 'true');
    res.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.headers.set('Access-Control-Allow-Headers', request.headers.get('access-control-request-headers') || 'Content-Type, Authorization');
    return res;
  }

  // Handle subdomain routing
  const hostname = request.headers.get('host') || '';
  const url = request.nextUrl.clone();

  // Check if this is a brands subdomain request
  if (hostname.startsWith('brands.')) {
    url.pathname = '/brand';
    return NextResponse.rewrite(url);
  }

  const authToken = request.cookies.get('site_auth_token');
  const { pathname } = request.nextUrl;
  const maintenanceEnabled = process.env.MAINTENANCE === 'true';

  // ALWAYS allow access to the root path and brand page - marketing pages should be accessible to everyone
  if (pathname === '/' || pathname === '/brand') {
    return NextResponse.next();
  }

  // Maintenance mode: Require authentication to bypass
  if (maintenanceEnabled) {
    // Allow maintenance page itself, login API, maintenance status API, and Next internal/static assets
    if (
      pathname.startsWith('/maintenance') ||
      pathname.startsWith('/api/login') ||
      pathname.startsWith('/api/maintenance-status') ||
      pathname.startsWith('/_next') ||
      pathname.includes('.') // Static files like images, fonts, etc.
    ) {
      return NextResponse.next();
    }

    // If authenticated, allow access to the app (bypass maintenance)
    if (authToken && authToken.value === 'valid') {
      return NextResponse.next();
    }

    // Otherwise redirect to maintenance page with login form
    const maintenanceUrl = new URL('/maintenance', request.url);
    return NextResponse.redirect(maintenanceUrl);
  }

  // Normal mode (maintenance OFF): Allow all access without authentication
  // Just allow APIs and static assets to pass through
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/_next') || // Next.js internal assets
    pathname.includes('.') // Static assets (e.g., /Tab.png, /logo.svg)
  ) {
    return NextResponse.next();
  }

  // All other paths are freely accessible when maintenance is OFF
  return NextResponse.next();
}

// Config to specify which paths the middleware should run on.
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}; 