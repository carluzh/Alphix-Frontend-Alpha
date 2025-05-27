import type { NextApiRequest, NextApiResponse } from 'next';

// Subgraph URL (same as in get-rolling-volume-fees.ts)
const SUBGRAPH_URL = "https://api.studio.thegraph.com/query/111443/alphix-v-4/version/latest";

// GraphQL query to fetch fee updates for a given pool within a time range
const GET_HISTORICAL_FEE_UPDATES_QUERY = `
  query GetFeeUpdatesForPool($poolId: Bytes!, $cutoffTimestamp: BigInt!) {
    feeUpdates(
      where: {
        pool: $poolId,
        timestamp_gte: $cutoffTimestamp
      }
      orderBy: timestamp
      orderDirection: asc
    ) {
      id
      timestamp
      newFeeRateBps # In Basis Points, e.g., "30" for 0.30%
      transactionHash
    }
  }
`;

// NEW: GraphQL query to fetch pool day data (volume and TVL)
const GET_POOL_DAY_DATAS_QUERY = `
  query GetPoolDayDatas($poolId: Bytes!, $startDateTimestamp: Int!, $endDateTimestamp: Int!) {
    poolDayDatas(
      orderBy: date
      orderDirection: asc
      where: {
        pool: $poolId,
        date_gte: $startDateTimestamp,
        date_lte: $endDateTimestamp
      }
    ) {
      id
      date      
      volumeUSD 
      tvlUSD    
    }
  }
`;

interface SubgraphFeeUpdate {
    id: string;
    timestamp: string;
    newFeeRateBps: string;
    transactionHash: string;
}

// NEW: Interface for Subgraph PoolDayData
interface SubgraphPoolDayData {
    id: string;
    date: string; // Timestamp (seconds since epoch for the start of the day)
    volumeUSD: string;
    tvlUSD: string;
}

interface SubgraphFeeResponse {
    data?: {
        feeUpdates: SubgraphFeeUpdate[];
    };
    errors?: any[];
}

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

    const nowInSeconds = Math.floor(Date.now() / 1000);
    const cutoffTimestampInSeconds = nowInSeconds - (days * 24 * 60 * 60);
    const endDateForPoolDayData = Math.floor(new Date().setUTCHours(0,0,0,0) / 1000); // Midnight today UTC
    const startDateForPoolDayData = endDateForPoolDayData - ((days -1) * 24 * 60 * 60); // Go back `days - 1` days

    const feeVariables = {
        poolId: poolId.toLowerCase(),
        cutoffTimestamp: BigInt(cutoffTimestampInSeconds).toString(),
    };

    const poolDayDataVariables = {
        poolId: poolId.toLowerCase(),
        startDateTimestamp: startDateForPoolDayData,
        endDateTimestamp: endDateForPoolDayData,
    };

    console.log(`API: Fetching historical fee updates for pool: ${poolId} since timestamp ${cutoffTimestampInSeconds}`);
    console.log(`API: Fetching pool day data for pool: ${poolId} from ${new Date(startDateForPoolDayData * 1000).toISOString()} to ${new Date(endDateForPoolDayData*1000).toISOString()}`);

    try {
        // Fetch both fee updates and pool day data in parallel
        const [feeResponse, poolDayDataResponse] = await Promise.all([
            fetch(SUBGRAPH_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: GET_HISTORICAL_FEE_UPDATES_QUERY,
                    variables: feeVariables,
                }),
            }),
            fetch(SUBGRAPH_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: GET_POOL_DAY_DATAS_QUERY,
                    variables: poolDayDataVariables,
                }),
            })
        ]);

        if (!feeResponse.ok) {
            const errorBody = await feeResponse.text();
            throw new Error(`Subgraph query for fee updates failed: ${errorBody}`);
        }
        if (!poolDayDataResponse.ok) {
            const errorBody = await poolDayDataResponse.text();
            throw new Error(`Subgraph query for pool day data failed: ${errorBody}`);
        }

        const feeResult = (await feeResponse.json()) as SubgraphFeeResponse;
        const poolDayDataResult = (await poolDayDataResponse.json()) as SubgraphPoolDayDataResponse;

        if (feeResult.errors) throw new Error(`Subgraph error(s) for fee updates: ${JSON.stringify(feeResult.errors)}`);
        if (poolDayDataResult.errors) throw new Error(`Subgraph error(s) for pool day data: ${JSON.stringify(poolDayDataResult.errors)}`);

        const feeUpdates = feeResult.data?.feeUpdates || [];
        const poolDayDatas = poolDayDataResult.data?.poolDayDatas || [];

        if (feeUpdates.length === 0) {
            console.log(`API: No fee update data found for pool ${poolId} in the past ${days} days.`);
            // We might still want to return data if poolDayDatas exist, but with default/zero fees
            // For now, if no fee updates, assume we can't proceed meaningfully for dynamic fee trend.
            return res.status(200).json([]); 
        }

        const sortedFeeUpdates = feeUpdates.sort((a, b) => parseInt(a.timestamp) - parseInt(b.timestamp));
        
        // Create a map for quick lookup of pool day data by date (YYYY-MM-DD string)
        const dayDataMap = new Map<string, { volumeUSD: number; tvlUSD: number }>();
        poolDayDatas.forEach(pdd => {
            const dateStr = new Date(parseInt(pdd.date) * 1000).toISOString().split('T')[0];
            dayDataMap.set(dateStr, {
                volumeUSD: parseFloat(pdd.volumeUSD || "0"),
                tvlUSD: parseFloat(pdd.tvlUSD || "0"),
            });
        });

        const dailyFeeHistoryPoints: FeeHistoryPoint[] = [];
        const endDateLoop = new Date(); // Today
        const startDateLoop = new Date();
        startDateLoop.setDate(endDateLoop.getDate() - (days - 1)); 

        let currentFeeBpsNum = parseFloat(sortedFeeUpdates[0].newFeeRateBps);
        const volumeTvlRatiosForEma: number[] = [];

        for (let d = new Date(startDateLoop); d <= endDateLoop; d.setDate(d.getDate() + 1)) {
            const loopDayTimestampSeconds = Math.floor(d.getTime() / 1000);
            const loopDateString = d.toISOString().split('T')[0]; // YYYY-MM-DD

            let activeFeeForDay = currentFeeBpsNum;
            for (const update of sortedFeeUpdates) {
                const updateTimestampSeconds = parseInt(update.timestamp);
                if (updateTimestampSeconds <= loopDayTimestampSeconds) {
                    activeFeeForDay = parseFloat(update.newFeeRateBps);
                } else {
                    break;
                }
            }
            currentFeeBpsNum = activeFeeForDay;
            const dynamicFeeValue = activeFeeForDay / 10000;

            const dayData = dayDataMap.get(loopDateString);
            const volumeUSD = dayData?.volumeUSD || 0;
            const tvlUSD = dayData?.tvlUSD || 0;
            const volumeTvlRatio = tvlUSD > 0 ? parseFloat((volumeUSD / tvlUSD).toFixed(4)) : 0;
            volumeTvlRatiosForEma.push(volumeTvlRatio);

            dailyFeeHistoryPoints.push({
                timeLabel: d.toLocaleDateString(), 
                volumeTvlRatio: volumeTvlRatio,
                emaRatio: 0, // Placeholder, will be filled next
                dynamicFee: dynamicFeeValue,
            });
        }

        // Calculate EMA for volumeTvlRatio
        const emaPeriod = 10; // Define your EMA period, e.g., 10 days
        const emaValues = calculateEMA(volumeTvlRatiosForEma, emaPeriod);

        // Add EMA values to the data points
        for (let i = 0; i < dailyFeeHistoryPoints.length; i++) {
            if (dailyFeeHistoryPoints[i] && emaValues[i] !== undefined) { // Check if emaValues[i] exists
                 dailyFeeHistoryPoints[i].emaRatio = emaValues[i];
            }
        }
        
        console.log(`API: Successfully processed ${dailyFeeHistoryPoints.length} daily data points for pool ${poolId}.`);
        return res.status(200).json(dailyFeeHistoryPoints);

    } catch (error: any) {
        console.error(`API Error in /api/liquidity/get-historical-dynamic-fees for pool ${poolId} (${days} days):`, error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred while fetching historical fee data.";
        const detailedError = process.env.NODE_ENV === 'development' ? { name: error.name, stack: error.stack } : {};
        return res.status(500).json({ message: errorMessage, error: detailedError });
    }
} 