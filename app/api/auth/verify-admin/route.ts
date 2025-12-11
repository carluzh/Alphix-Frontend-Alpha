import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminPassword) {
      return NextResponse.json(
        { success: false, error: 'Admin password not configured' },
        { status: 500 }
      );
    }

    if (password === adminPassword) {
      return NextResponse.json({ success: true });
    }

    return NextResponse.json(
      { success: false, error: 'Invalid password' },
      { status: 401 }
    );
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid request' },
      { status: 400 }
    );
  }
}
