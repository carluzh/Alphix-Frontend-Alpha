import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/api/ratelimit'

export async function GET(request: Request) {
  const rateLimited = await checkRateLimit(request);
  if (rateLimited) return rateLimited;

  const maintenance = process.env.NEXT_PUBLIC_MAINTENANCE === 'true' || process.env.MAINTENANCE === 'true'
  return NextResponse.json({ maintenance })
}


