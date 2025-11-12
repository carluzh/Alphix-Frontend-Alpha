import { NextResponse } from 'next/server';
import { deleteCachedData } from '@/lib/redis';

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key') || 'pools-batch:v1';

    await deleteCachedData(key);

    return NextResponse.json({
      success: true,
      message: `Cache cleared for key: ${key}`
    });
  } catch (error: any) {
    console.error('[Cache Clear] Error:', error);
    return NextResponse.json({
      success: false,
      message: error?.message || 'Failed to clear cache'
    }, { status: 500 });
  }
}
