import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
// import { cookies } from 'next/headers'; // Not used in Middleware for reading cookies

export function middleware(request: NextRequest) {
  const authToken = request.cookies.get('site_auth_token');
  const { pathname } = request.nextUrl;
  const maintenanceEnabled = process.env.NEXT_PUBLIC_MAINTENANCE === 'true' || process.env.MAINTENANCE === 'true';

  console.log(`[MIDDLEWARE] Path: ${pathname}, Auth Token: ${authToken?.value || 'none'}`);

  // ALWAYS allow access to the root path - marketing page should be accessible to everyone
  if (pathname === '/') {
    console.log(`[MIDDLEWARE] Allowing root path access`);
    return NextResponse.next();
  }

  // Maintenance mode: Only '/' and '/login' (and static) are freely accessible.
  if (maintenanceEnabled) {
    // Allow login page and Next internal/static assets
    if (
      pathname.startsWith('/login') ||
      pathname.startsWith('/_next') ||
      pathname.includes('.')
    ) {
      return NextResponse.next();
    }

    // All other paths require auth during maintenance
    if (!authToken || authToken.value !== 'valid') {
      console.log(`[MIDDLEWARE] (Maintenance) Redirecting ${pathname} to login - no valid auth`);
      const loginUrl = new URL('/login', request.url);
      return NextResponse.redirect(loginUrl);
    }

    // If already on /maintenance, allow
    if (pathname.startsWith('/maintenance')) {
      return NextResponse.next();
    }

    // Redirect any other path to /maintenance
    console.log(`[MIDDLEWARE] (Maintenance) Redirecting ${pathname} to /maintenance`);
    const maintenanceUrl = new URL('/maintenance', request.url);
    return NextResponse.redirect(maintenanceUrl);
  }

  // Normal mode: Allow login page, APIs, and static assets without auth check
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/_next') || // Next.js internal assets
    pathname.includes('.') // Static assets (e.g., /Tab.png, /logo.svg)
  ) {
    return NextResponse.next();
  }

  // All other paths require authentication
  if (!authToken || authToken.value !== 'valid') {
    console.log(`[MIDDLEWARE] Redirecting ${pathname} to login - no valid auth`);
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  // If the token is valid, allow the request to proceed
  console.log(`[MIDDLEWARE] Allowing authenticated access to ${pathname}`);
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