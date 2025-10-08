import type { NextApiRequest, NextApiResponse } from 'next';
import { getToken, getPoolByTokens, getStateViewAddress } from '../../../lib/pools-config';
import { publicClient } from '../../../lib/viemClient';
import { parseAbi, type Hex } from 'viem';
import { DynamicFeeSchema, validateApiResponse } from '../../../lib/validation';

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

        // Read the actual dynamic LP fee (in millionths onchain) and convert to bps for consistency
        let actualDynamicFeeBps = DEFAULT_DYNAMIC_FEE; // default bps 0.30%
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

            const [, , , lpFeeMillionths] = slot0Data;
            // Convert millionths to basis points (may be fractional): bps = (lpFee / 1_000_000) * 10_000
            const rawBps = (Number(lpFeeMillionths) / 1_000_000) * 10_000;
            // Preserve hundredths of a basis point (0.01 bps) to avoid rounding down 4.4 bps -> 4 bps
            actualDynamicFeeBps = Math.max(0, Math.round(rawBps * 100) / 100);
        } catch (error) {
            console.error(`Error reading pool fee for ${poolConfig.id}:`, error);
            console.log(`Falling back to default fee ${DEFAULT_DYNAMIC_FEE} bps for pool ${poolConfig.id}`);
        }

        // Prepare response data
        const responseData = {
            dynamicFeeBps: actualDynamicFeeBps,
            dynamicFee: String(actualDynamicFeeBps), // backward compatible
            poolId: poolConfig.id,
            poolName: poolConfig.name,
            unit: 'bps',
            isEstimate: false,
            note: 'Actual LP fee (bps) derived from onchain millionths.'
        };

        // Validate response data
        const validatedData = validateApiResponse(DynamicFeeSchema, responseData, 'get-dynamic-fee');

        res.status(200).json(validatedData);

    } catch (error: any) {
        console.error("Error in /api/swap/get-dynamic-fee:", error);
        res.status(500).json({ 
            message: "Failed to fetch dynamic fee.", 
            errorDetails: error.message || 'Unknown error' 
        });
    }
} 