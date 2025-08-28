import { NextResponse } from 'next/server'

export async function GET() {
  const maintenance = process.env.NEXT_PUBLIC_MAINTENANCE === 'true' || process.env.MAINTENANCE === 'true'
  return NextResponse.json({ maintenance })
}


