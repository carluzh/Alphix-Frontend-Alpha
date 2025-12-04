export const runtime = 'nodejs';
export const preferredRegion = 'auto';

import { NextResponse } from 'next/server';

/**
 * Batch Uncollected Fees API
 *
 * Returns uncollected fees for multiple positions in a single request.
 * No Redis caching - user-specific data is cached client-side via React Query.
 */
export async function POST(request: Request) {
  try {
    const baseUrl = new URL(request.url).origin;

    const body = await request.json();
    const { positionIds } = body;

    if (!Array.isArray(positionIds) || positionIds.length === 0) {
      return NextResponse.json(
        { success: false, message: 'positionIds array is required' },
        { status: 400 }
      );
    }

    const fees = await fetchFeesFromExistingAPI(positionIds, baseUrl);

    return NextResponse.json({
      success: true,
      items: fees,
      isStale: false,
    });
  } catch (error: any) {
    console.error('[Fees API] Error:', error);
    return NextResponse.json(
      { success: false, message: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}

async function fetchFeesFromExistingAPI(positionIds: string[], baseUrl: string): Promise<any[]> {
  const response = await fetch(
    `${baseUrl}/api/liquidity/get-uncollected-fees`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ positionIds }),
      cache: 'no-store',
    }
  );

  if (!response.ok) {
    throw new Error(`Existing API returned HTTP ${response.status}`);
  }

  const data = await response.json();

  if (!data.success || !Array.isArray(data.items)) {
    throw new Error('Invalid response format from existing API');
  }

  return data.items;
}
