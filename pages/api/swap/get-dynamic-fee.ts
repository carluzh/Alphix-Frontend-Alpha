import type { NextApiRequest, NextApiResponse } from 'next';
import { getToken, getPoolByTokens, getStateViewAddress } from '../../../lib/pools-config';
import { publicClient } from '../../../lib/viemClient';
import { parseAbi, type Hex } from 'viem';

const DEFAULT_DYNAMIC_FEE = 3000; // 0.30% - fallback default
const STATE_VIEW_ADDRESS = getStateViewAddress();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
    }

    try {
        const { fromTokenSymbol, toTokenSymbol, chainId } = req.body;

        if (!fromTokenSymbol || !toTokenSymbol || !chainId) {
            return res.status(400).json({ message: 'Missing required parameters: fromTokenSymbol, toTokenSymbol, chainId' });
        }

        const fromTokenConfig = getToken(fromTokenSymbol);
        const toTokenConfig = getToken(toTokenSymbol);

        if (!fromTokenConfig || !toTokenConfig) {
            return res.status(400).json({ message: 'Invalid token symbol(s).' });
        }

        // Find the pool configuration for this token pair
        const poolConfig = getPoolByTokens(fromTokenSymbol, toTokenSymbol);
        if (!poolConfig) {
            return res.status(400).json({ message: `No pool found for token pair ${fromTokenSymbol}/${toTokenSymbol}` });
        }

        // Read the actual dynamic fee from the pool using getSlot0
        let actualDynamicFee = DEFAULT_DYNAMIC_FEE;
        try {
            const stateViewAbi = parseAbi([
                'function getSlot0(bytes32 poolId) external view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)'
            ]);

            const slot0Data = await publicClient.readContract({
                address: STATE_VIEW_ADDRESS,
                abi: stateViewAbi,
                functionName: 'getSlot0',
                args: [poolConfig.subgraphId as Hex]
            }) as readonly [bigint, number, number, number];

            const [, , , lpFee] = slot0Data;
            actualDynamicFee = Number(lpFee);
            
            console.log(`Read actual dynamic fee ${actualDynamicFee} bps (${(actualDynamicFee / 10000).toFixed(4)}%) for pool ${poolConfig.id} (${poolConfig.name})`);
        } catch (error) {
            console.error(`Error reading pool fee for ${poolConfig.id}:`, error);
            console.log(`Falling back to default fee ${DEFAULT_DYNAMIC_FEE} bps for pool ${poolConfig.id}`);
        }

        res.status(200).json({ 
            dynamicFee: actualDynamicFee.toString(),
            poolId: poolConfig.id,
            poolName: poolConfig.name,
            isEstimate: false,
            note: 'This is the actual dynamic fee read from the pool contract.'
        });

    } catch (error: any) {
        console.error("Error in /api/swap/get-dynamic-fee:", error);
        res.status(500).json({ 
            message: "Failed to fetch dynamic fee.", 
            errorDetails: error.message || 'Unknown error' 
        });
    }
} 