export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { redis } from '@/lib/cache/redis'
import { checkRateLimit } from '@/lib/api/ratelimit'
import type { TosAcceptanceRecord } from '../accept/route'

export async function GET(request: Request) {
  // Rate limit
  const rateLimitResponse = await checkRateLimit(request)
  if (rateLimitResponse) return rateLimitResponse

  if (!redis) {
    return NextResponse.json(
      { error: 'Service unavailable' },
      { status: 503 }
    )
  }

  const { searchParams } = new URL(request.url)
  const address = searchParams.get('address')

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json(
      { error: 'Valid Ethereum address required' },
      { status: 400 }
    )
  }

  const key = `tos:accepted:${address.toLowerCase()}`

  try {
    const raw = await redis.get<string>(key)

    if (!raw) {
      return NextResponse.json(
        { accepted: false },
        { headers: { 'Cache-Control': 'no-store' } }
      )
    }

    // Parse the record to extract version
    let tosVersion: string | undefined
    try {
      const record: TosAcceptanceRecord = typeof raw === 'string' ? JSON.parse(raw) : raw
      tosVersion = record.tosVersion
    } catch {
      // Old format — accepted but no version info
      tosVersion = undefined
    }

    return NextResponse.json(
      { accepted: true, tosVersion },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('[/api/tos/status] Redis read failed:', error)
    return NextResponse.json(
      { error: 'Failed to check acceptance status' },
      { status: 500 }
    )
  }
}
