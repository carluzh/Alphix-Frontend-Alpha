import { NextResponse } from 'next/server';
// import { cookies } from 'next/headers'; // Not needed for setting cookies in a response

export async function POST(request: Request) {
  try {
    const { password } = await request.json();
    const sitePassword = process.env.SITE_PASSWORD;

    if (!sitePassword) {
      console.error('SITE_PASSWORD environment variable is not set.');
      return NextResponse.json({ message: 'Server configuration error.' }, { status: 500 });
    }

    if (password === sitePassword) {
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
      return response;
    } else {
      return NextResponse.json({ message: 'Invalid password' }, { status: 401 });
    }
  } catch (error) {
    console.error('Login API error:', error);
    return NextResponse.json({ message: 'An unexpected error occurred.' }, { status: 500 });
  }
} 