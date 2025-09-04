import { revalidateTag } from 'next/cache';

export const runtime = 'nodejs';
export const preferredRegion = 'auto';

export async function POST(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get('secret') || req.headers.get('x-internal-secret') || '';
  if (secret !== (process.env.INTERNAL_API_SECRET || '')) {
    return Response.json({ message: 'Invalid secret' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    revalidateTag('pools-batch');
    return Response.json({ revalidated: true, tag: 'pools-batch', now: Date.now() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    return Response.json({ message: e?.message || 'Revalidation failed' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}


