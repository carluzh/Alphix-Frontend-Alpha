import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
// import { cookies } from 'next/headers'; // Not used in Middleware for reading cookies

export function middleware(request: NextRequest) {
  const authToken = request.cookies.get('site_auth_token');
  const { pathname } = request.nextUrl;

  console.log(`[MIDDLEWARE] Path: ${pathname}, Auth Token: ${authToken?.value || 'none'}`);

  // ALWAYS allow access to the root path - marketing page should be accessible to everyone
  if (pathname === '/') {
    console.log(`[MIDDLEWARE] Allowing root path access`);
    return NextResponse.next();
  }

  // Allow login page, APIs, and static assets without auth check
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
    '/((?!_next/static|_next/image|favicon.ico|api).*)',
  ],
}; 