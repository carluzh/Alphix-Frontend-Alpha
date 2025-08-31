// API route rate limiting middleware

import { NextRequest, NextResponse } from 'next/server';
import { rateLimitMiddleware } from '../lib/rateLimiter';

export interface RateLimitedRequest extends NextRequest {
  rateLimit?: {
    allowed: boolean;
    retryAfter?: number;
  };
}

export async function withRateLimit(
  request: NextRequest,
  context: { type: 'subgraph' | 'rpc'; endpoint?: string }
): Promise<RateLimitedRequest> {
  const rateLimit = await rateLimitMiddleware(request as any, context);

  const enhancedRequest = request as RateLimitedRequest;
  enhancedRequest.rateLimit = rateLimit;

  return enhancedRequest;
}

export function createRateLimitResponse(retryAfter: number): NextResponse {
  return new NextResponse(
    JSON.stringify({
      error: 'Rate limit exceeded',
      retryAfter,
      message: `Too many requests. Try again in ${retryAfter} seconds.`,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': retryAfter.toString(),
        'X-RateLimit-Reset': new Date(Date.now() + retryAfter * 1000).toISOString(),
      },
    }
  );
}

// Helper to apply rate limiting to API routes
export async function rateLimitHandler(
  request: NextRequest,
  handler: (req: RateLimitedRequest) => Promise<NextResponse>,
  context: { type: 'subgraph' | 'rpc'; endpoint?: string }
): Promise<NextResponse> {
  const rateLimitedRequest = await withRateLimit(request, context);

  if (!rateLimitedRequest.rateLimit?.allowed) {
    return createRateLimitResponse(rateLimitedRequest.rateLimit?.retryAfter || 60);
  }

  return handler(rateLimitedRequest);
}


