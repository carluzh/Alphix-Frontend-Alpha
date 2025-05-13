import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
// import { cookies } from 'next/headers'; // Not used in Middleware for reading cookies

export function middleware(request: NextRequest) {
  const authToken = request.cookies.get('site_auth_token');
  const { pathname } = request.nextUrl;

  // Allow requests to certain paths to pass through without auth check
  if (
    pathname.startsWith('/login') || 
    pathname.startsWith('/api') || 
    pathname.startsWith('/_next') || // Next.js internal assets
    pathname.includes('.') // Likely a static asset (e.g., /Tab.png, /logo.svg)
  ) {
    return NextResponse.next();
  }

  // If there's no valid auth token, redirect to the login page
  if (!authToken || authToken.value !== 'valid') {
    const loginUrl = new URL('/login', request.url);
    // Optionally, pass the original path to redirect back after login
    // loginUrl.searchParams.set('redirect_to', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // If the token is valid, allow the request to proceed
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
     * (These are already excluded by the pathname.includes('.') check above or pathname.startsWith('/_next'))
     * 
     * The goal is to run on page routes but not on static asset requests.
     */
    '/((?!_next/static|_next/image|favicon.ico|api/login).*)', // Exclude login API too
  ],
}; 