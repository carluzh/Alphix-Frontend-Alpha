import type { NextApiRequest, NextApiResponse } from 'next';
import { getToken, getPoolByTokens } from '../../../lib/pools-config';

const DEFAULT_DYNAMIC_FEE = 3000; // 0.30% - reasonable default for quotes

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

        console.log(`Using default dynamic fee ${DEFAULT_DYNAMIC_FEE} for pool ${poolConfig.id} (${poolConfig.name}). Actual dynamic fee will be applied during swap execution.`);

        // Return default fee for quote purposes
        // The actual dynamic fee will be determined by the hook during swap execution
        res.status(200).json({ 
            dynamicFee: DEFAULT_DYNAMIC_FEE.toString(),
            poolId: poolConfig.id,
            poolName: poolConfig.name,
            isEstimate: true,
            note: 'This is an estimate for quote purposes. Actual dynamic fee will be applied during swap execution.'
        });

    } catch (error: any) {
        console.error("Error in /api/swap/get-dynamic-fee:", error);
        res.status(500).json({ 
            message: "Failed to fetch dynamic fee.", 
            errorDetails: error.message || 'Unknown error' 
        });
    }
} 