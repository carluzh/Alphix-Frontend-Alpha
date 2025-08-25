import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { tickSpacing } = req.body ?? {};
    const spacingNum = Number(tickSpacing);
    const bucketSize = Number.isFinite(spacingNum) && spacingNum > 0 ? spacingNum : 1;

    return res.status(200).json({
      success: true,
      buckets: [],
      bucketSize,
      totalBuckets: 0,
      totalPositions: 0,
      disabled: true,
      message: 'Depth rendered client-side from subgraph positions',
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Internal server error', details: err?.message || String(err) });
  }
}


