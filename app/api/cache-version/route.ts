export const runtime = 'nodejs';
export const preferredRegion = 'auto';

export async function GET() {
  // Return current timestamp as version
  const version = Date.now();
  return Response.json({
    version,
    cacheUrl: `/api/liquidity/get-pools-batch?v=${version}`
  }, {
    headers: { 'Cache-Control': 'no-store' }
  });
}
