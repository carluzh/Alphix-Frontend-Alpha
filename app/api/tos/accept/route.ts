export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { verifyMessage } from 'viem'
import { z } from 'zod'
import { redis } from '@/lib/cache/redis'
import { checkRateLimit } from '@/lib/api/ratelimit'
import { TOS_SIGNATURE_MESSAGE, TOS_VERSION } from '@/lib/tos-content'

const AcceptBodySchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
  message: z.string(),
})

export interface TosAcceptanceRecord {
  signature: string
  message: string
  tosVersion: string
  timestamp: number
  ip: string
  userAgent: string
}

export async function POST(request: Request) {
  // Rate limit
  const rateLimitResponse = await checkRateLimit(request)
  if (rateLimitResponse) return rateLimitResponse

  if (!redis) {
    return NextResponse.json(
      { error: 'Service unavailable' },
      { status: 503 }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = AcceptBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { address, signature, message } = parsed.data

  // Message must match the current TOS signature message exactly
  if (message !== TOS_SIGNATURE_MESSAGE) {
    return NextResponse.json(
      { error: 'Message does not match current Terms of Service' },
      { status: 400 }
    )
  }

  // Verify the signature cryptographically
  let isValid: boolean
  try {
    isValid = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    })
  } catch {
    return NextResponse.json(
      { error: 'Signature verification failed' },
      { status: 400 }
    )
  }

  if (!isValid) {
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 400 }
    )
  }

  // Build acceptance record
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const userAgent = request.headers.get('user-agent') ?? 'unknown'

  const record: TosAcceptanceRecord = {
    signature,
    message,
    tosVersion: TOS_VERSION,
    timestamp: Date.now(),
    ip,
    userAgent,
  }

  const key = `tos:accepted:${address.toLowerCase()}`

  try {
    // Store the acceptance record (no TTL — permanent)
    await redis.set(key, JSON.stringify(record))

    // Append to audit log (append-only list for backup/compliance)
    await redis.rpush('tos:log', JSON.stringify({ address: address.toLowerCase(), ...record }))
  } catch (error) {
    console.error('[/api/tos/accept] Redis write failed:', error)
    return NextResponse.json(
      { error: 'Failed to store acceptance' },
      { status: 500 }
    )
  }

  return NextResponse.json(
    { accepted: true, tosVersion: TOS_VERSION },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
