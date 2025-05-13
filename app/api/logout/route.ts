import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const response = NextResponse.json({ message: 'Logout successful' }, { status: 200 });

    // Clear the authentication cookie by setting its expiry to a past date
    response.cookies.set('site_auth_token', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: new Date(0), // Set to a past date
    });

    return response;
  } catch (error) {
    console.error('Logout API error:', error);
    return NextResponse.json({ message: 'An unexpected error occurred during logout.' }, { status: 500 });
  }
} 