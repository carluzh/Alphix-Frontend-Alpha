import type { NextApiRequest, NextApiResponse } from 'next';
import { batchGetTokenPrices, calculateTotalUSD, calculateSwapVolumeUSD } from '../../../lib/price-service';
import { getTokenDecimals, getAllPools } from '../../../lib/pools-config';
import { formatUnits } from 'viem';

// Simple in-memory cache to minimize subgraph calls
const HIST_CACHE = new Map<string, { ts: number; data: FeeHistoryPoint[] }>();
const HIST_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Subgraph URL selection (Satsuma default with env/query overrides)
const LEGACY_SUBGRAPH_URL = process.env.SUBGRAPH_URL || "";
function selectSubgraphUrl(_req: NextApiRequest): string {
  const envDefault = process.env.NEXT_PUBLIC_SUBGRAPH_URL || process.env.SUBGRAPH_URL;
  return envDefault || LEGACY_SUBGRAPH_URL;
}
// Hook-based fee updates (new Satsuma schema)
const GET_HOOK_FEE_UPDATES_QUERY = `
  query GetHookFeeUpdates($poolId: Bytes!, $cutoffTimestamp: BigInt!) {
    alphixHooks(
      where: { pool: $poolId, timestamp_gte: $cutoffTimestamp }
      orderBy: timestamp
      orderDirection: asc
      first: 60
    ) {
      timestamp
      newFeeBps
      currentTargetRatio
      newTargetRatio
    }
  }
`;

interface SubgraphFeeUpdate { id?: string; timestamp: string; newFeeRateBps: string; transactionHash?: string }
interface HookFeeUpdate { timestamp: string; newFeeBps?: string; newFeeRateBps?: string }

// NEW: Interface for Subgraph PoolDayData
interface SubgraphPoolDayData { date: string; volumeToken0: string; volumeToken1: string }

interface SubgraphFeeResponse { data?: { feeUpdates: SubgraphFeeUpdate[] }; errors?: any[] }
interface HookFeeResponse { data?: { alphixHooks: HookFeeUpdate[] }; errors?: any[] }

// NEW: Interface for Subgraph PoolDayData Response
interface SubgraphPoolDayDataResponse {
    data?: {
        poolDayDatas: SubgraphPoolDayData[];
    };
    errors?: any[];
}

// This interface should match the one expected by DynamicFeeChartPreviewProps
interface FeeHistoryPoint {
  timeLabel: string;
  volumeTvlRatio: number; // Placeholder for now
  emaRatio: number; // Placeholder for now
  dynamicFee: number; // e.g., 0.31 for 0.31%
}

interface ErrorResponse {
    message: string;
    error?: any;
}

// NEW: Helper function to calculate EMA
function calculateEMA(data: number[], period: number): number[] {
    if (!data || data.length === 0 || period <= 0 || period > data.length) {
        return new Array(data.length).fill(0); // Return array of zeros if input is invalid
    }
    const k = 2 / (period + 1);
    const emaArray: number[] = [];
    // First EMA is the average of the first 'period' values
    let sum = 0;
    for (let i = 0; i < period; i++) {
        sum += data[i];
    }
    emaArray[period - 1] = sum / period;

    // Calculate subsequent EMAs
    for (let i = period; i < data.length; i++) {
        emaArray[i] = (data[i] * k) + (emaArray[i - 1] * (1 - k));
    }
    // Fill initial EMAs with a simple moving average or NaN/0 if preferred (here, filling with 0 for simplicity before first full period)
    for (let i = 0; i < period -1; i++) {
        let simpleMovingAverage = 0;
        let count = 0;
        for(let j=0; j<=i; j++){
            simpleMovingAverage += data[j];
            count++;
        }
        emaArray[i] = count > 0 ? simpleMovingAverage / count : 0;
    }
    return emaArray.map(val => parseFloat(val.toFixed(4))); // Return with precision
}

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse<FeeHistoryPoint[] | ErrorResponse>
) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
    }

    const { poolId, days: daysQuery } = req.query;

    if (!poolId || typeof poolId !== 'string') {
        return res.status(400).json({ message: 'Valid poolId query parameter is required.' });
    }

    const days = parseInt(daysQuery as string, 10) || 30; // Default to 30 days if not specified or invalid
    if (days <= 0) {
        return res.status(400).json({ message: 'Optional \'days\' query parameter must be a positive integer if provided.' });
    }
    // CDN edge caching: cache per poolId+days for 6h, serve stale for 6h while revalidating
    res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=21600');

    const nowInSeconds = Math.floor(Date.now() / 1000);
    const cutoffTimestampInSeconds = nowInSeconds - (days * 24 * 60 * 60);
    
    // For fee updates, look back much further to capture all historical changes
    // Fee updates are rare, so we need to look back further than just the display period
    const feeUpdatesCutoffTimestamp = nowInSeconds - (365 * 24 * 60 * 60); // Look back 1 year for fee updates
    
    const endDateForLoop = Math.floor(new Date().setUTCHours(0,0,0,0) / 1000); // Midnight today UTC
    const startDateForLoop = endDateForLoop - ((days -1) * 24 * 60 * 60);

    const feeVariables = {
        poolId: poolId.toLowerCase(),
        cutoffTimestamp: BigInt(feeUpdatesCutoffTimestamp).toString(), // Use longer period for fee updates
    };

    try {
        // Cache key and check
        const cacheKey = `${feeVariables.poolId}:${days}`;
        const cached = HIST_CACHE.get(cacheKey);
        if (cached && (Date.now() - cached.ts) < HIST_TTL_MS) {
            return res.status(200).json(cached.data);
        }

        // Fetch hook updates only (ratio + fee)
        const SUBGRAPH_URL = selectSubgraphUrl(req);
        const preferHook = true;
        const feeResponse = await fetch(SUBGRAPH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: GET_HOOK_FEE_UPDATES_QUERY,
                variables: feeVariables,
            }),
        });

        if (!feeResponse.ok) {
            const errorBody = await feeResponse.text();
            throw new Error(`Subgraph query for fee updates failed: ${errorBody}`);
        }
        let feeRaw = await feeResponse.json();

        // If legacy path failed due to missing field, auto-retry with hook query (kept for safety)
        if (feeRaw?.errors) {
            const messages = Array.isArray(feeRaw.errors) ? feeRaw.errors.map((e: any) => String(e?.message || '')) : [];
            const missingLegacy = messages.some(m => m.includes('feeUpdates'));
            if (!preferHook && missingLegacy) {
                const retry = await fetch(SUBGRAPH_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: GET_HOOK_FEE_UPDATES_QUERY, variables: feeVariables }),
                });
                if (retry.ok) {
                    const retriedJson = await retry.json();
                    if (!retriedJson?.errors) {
                        feeRaw = retriedJson;
                    } else {
                        throw new Error(`Subgraph error(s) for fee updates (retry): ${JSON.stringify(retriedJson.errors)}`);
                    }
                } else {
                    const body = await retry.text();
                    throw new Error(`Subgraph fee updates retry failed: ${body}`);
                }
            } else {
                throw new Error(`Subgraph error(s) for fee updates: ${JSON.stringify(feeRaw.errors)}`);
            }
        }
        // No PoolDayData; ratios sourced from hook

        // Normalize fee updates from either schema (carry target ratio when present)
        let normalizedUpdates: { timestamp: string; bps: number; target?: number; nextTarget?: number }[] = [];
        const hookResp = feeRaw as HookFeeResponse;
        const legacyResp = feeRaw as SubgraphFeeResponse;
        if (hookResp?.data?.alphixHooks) {
            normalizedUpdates = hookResp.data.alphixHooks.map((u: any) => ({
                timestamp: String(u.timestamp),
                bps: Number(u.newFeeBps ?? u.newFeeRateBps ?? '0'),
                target: u?.currentTargetRatio !== undefined && u?.currentTargetRatio !== null ? Number(u.currentTargetRatio) : undefined,
                nextTarget: u?.newTargetRatio !== undefined && u?.newTargetRatio !== null ? Number(u.newTargetRatio) : undefined,
            }));
        } else if (legacyResp?.data?.feeUpdates) {
            normalizedUpdates = legacyResp.data.feeUpdates.map(u => ({
                timestamp: String(u.timestamp),
                bps: Number(u.newFeeRateBps ?? '0')
            }));
        }

        // No PoolDayData in this mode

        // If no fee updates, use a default fee but still process pool data
        let sortedFeeUpdates = normalizedUpdates.sort((a, b) => parseInt(a.timestamp) - parseInt(b.timestamp));
        let defaultFeeIfNoUpdates = 3000; // Default to 0.3% if no fee updates found
        
        if (sortedFeeUpdates.length === 0) {
            console.log(`API: No fee update data found for pool ${poolId}, using default fee of ${defaultFeeIfNoUpdates} bps`);
            sortedFeeUpdates = [{ timestamp: '0', bps: defaultFeeIfNoUpdates }];
        }
        
        // Build day loop range

        const dailyFeeHistoryPoints: FeeHistoryPoint[] = [];
        const endDateLoop = new Date(endDateForLoop * 1000);
        const startDateLoop = new Date(startDateForLoop * 1000);

        // Infer scale: if any value is very large, assume micro-bps (1e6 = 100%). Otherwise standard bps (1e4 = 100%).
        const anyLarge = sortedFeeUpdates.some(u => Number(u.bps) > 100000);
        const scaleDivisor = anyLarge ? 1_000_000 : 10_000;
        let currentFeeBpsNum = parseFloat(String(sortedFeeUpdates[0].bps));
        const volumeTvlRatiosForEma: number[] = [];

        for (let d = new Date(startDateLoop); d <= endDateLoop; d.setDate(d.getDate() + 1)) {
            const loopDayTimestampSeconds = Math.floor(d.getTime() / 1000);
            const loopDateString = d.toISOString().split('T')[0]; // YYYY-MM-DD

            // Find the most recent fee update for this day
            let activeFeeForDay = currentFeeBpsNum;
            for (const update of sortedFeeUpdates) {
                const updateTimestampSeconds = parseInt(update.timestamp);
                if (updateTimestampSeconds <= loopDayTimestampSeconds) {
                    activeFeeForDay = parseFloat(String(update.bps));
                    currentFeeBpsNum = activeFeeForDay;
                } else {
                    break;
                }
            }
            
            // Convert fee to decimal percentage based on inferred scale
            const dynamicFeeValue = activeFeeForDay / scaleDivisor;

            // Ratio: use latest currentTargetRatio at or before this day
            let activeTarget: number | undefined = undefined;
            let activeNextTarget: number | undefined = undefined;
            for (const update of sortedFeeUpdates) {
                const updateTimestampSeconds = parseInt(update.timestamp);
                if (updateTimestampSeconds <= loopDayTimestampSeconds && (update as any).target !== undefined) {
                    activeTarget = Number((update as any).target);
                    if ((update as any).nextTarget !== undefined) {
                        activeNextTarget = Number((update as any).nextTarget);
                    }
                } else if (updateTimestampSeconds > loopDayTimestampSeconds) {
                    break;
                }
            }
            // Scale currentTargetRatio to a plain ratio in [0, +inf).
            // Priority: 1e18 -> 100% (divide by 1e18), else 1e14 -> 100% (divide by 1e14),
            // else fallback to 1e6/1e4 heuristics, else raw.
            let volumeTvlRatio = 0;
            if (typeof activeTarget === 'number') {
                const abs = Math.abs(activeTarget);
                if (abs >= 1e17) {
                    volumeTvlRatio = activeTarget / 1e18; // 1e18 == 100%
                } else if (abs >= 1e13) {
                    volumeTvlRatio = activeTarget / 1e14; // 1e14 == 100%
                } else if (abs >= 1e6) {
                    volumeTvlRatio = activeTarget / 1e6;  // micro-units
                } else if (abs >= 1e4) {
                    volumeTvlRatio = activeTarget / 1e4;  // bps-like
                } else {
                    volumeTvlRatio = activeTarget;
                }
                volumeTvlRatio = parseFloat(volumeTvlRatio.toFixed(6));
            }
            volumeTvlRatiosForEma.push(volumeTvlRatio);

            // Scale newTargetRatio identically; we will return it as emaRatio field
            let targetRatioForEma = 0;
            if (typeof activeNextTarget === 'number') {
                const abs = Math.abs(activeNextTarget);
                if (abs >= 1e17) {
                    targetRatioForEma = activeNextTarget / 1e18;
                } else if (abs >= 1e13) {
                    targetRatioForEma = activeNextTarget / 1e14;
                } else if (abs >= 1e6) {
                    targetRatioForEma = activeNextTarget / 1e6;
                } else if (abs >= 1e4) {
                    targetRatioForEma = activeNextTarget / 1e4;
                } else {
                    targetRatioForEma = activeNextTarget;
                }
                targetRatioForEma = parseFloat(targetRatioForEma.toFixed(6));
            }

            dailyFeeHistoryPoints.push({
                timeLabel: d.toISOString().split('T')[0], 
                volumeTvlRatio: volumeTvlRatio,
                emaRatio: targetRatioForEma, // Reused field to carry newTargetRatio
                dynamicFee: dynamicFeeValue,
            });
        }
        // NOTE: We now return emaRatio as the scaled newTargetRatio, not a computed EMA.
        
        console.log(`API: Successfully processed ${dailyFeeHistoryPoints.length} daily data points for pool ${poolId}.`);
        // save to cache
        HIST_CACHE.set(cacheKey, { ts: Date.now(), data: dailyFeeHistoryPoints });
        return res.status(200).json(dailyFeeHistoryPoints);

    } catch (error: any) {
        console.error(`API Error in /api/liquidity/get-historical-dynamic-fees for pool ${poolId} (${days} days):`, error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred while fetching historical fee data.";
        const detailedError = process.env.NODE_ENV === 'development' ? { name: error.name, stack: error.stack } : {};
        return res.status(500).json({ message: errorMessage, error: detailedError });
    }
} 