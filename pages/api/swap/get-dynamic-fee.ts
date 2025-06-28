import type { NextApiRequest, NextApiResponse } from 'next';
import { getAddress, type Address } from 'viem';
import { publicClient } from '../../../lib/viemClient';
import { V4_POOL_HOOKS_RAW, V4_POOL_TICK_SPACING } from '../../../lib/swap-constants'; // Removed V4_POOL_FEE as it's not directly used here for PoolKey arg
import { getToken, createTokenSDK } from '../../../lib/pools-config';
import { Token } from '@uniswap/sdk-core';

// ABI for the getDynamicFee function expecting a PoolKey struct
const hookAbi = [
    {
        name: 'getDynamicFee',
        type: 'function',
        stateMutability: 'view',
        inputs: [
            {
                name: 'key',
                type: 'tuple',
                components: [
                    { name: 'currency0', type: 'address' },
                    { name: 'currency1', type: 'address' },
                    { name: 'fee', type: 'uint24' },
                    { name: 'tickSpacing', type: 'int24' },
                    { name: 'hooks', type: 'address' },
                ],
            },
        ],
        outputs: [{ name: 'dynamicFee', type: 'uint24' }],
    },
] as const;

const DYNAMIC_FEE_FLAG = 0x800000; // The provided dynamic fee flag

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

        const tokenA = createTokenSDK(fromTokenSymbol, Number(chainId));
        const tokenB = createTokenSDK(toTokenSymbol, Number(chainId));
        
        if (!tokenA || !tokenB) {
            return res.status(400).json({ message: 'Failed to create token instances.' });
        }

        const token0ForPoolKey = tokenA.sortsBefore(tokenB) ? tokenA : tokenB;
        const token1ForPoolKey = tokenA.sortsBefore(tokenB) ? tokenB : tokenA;

        // Construct the PoolKey struct argument
        const poolKeyArgument = {
            currency0: getAddress(token0ForPoolKey.address),
            currency1: getAddress(token1ForPoolKey.address),
            fee: DYNAMIC_FEE_FLAG, // Use the DYNAMIC_FEE_FLAG
            tickSpacing: V4_POOL_TICK_SPACING, // Ensure this is int24 compatible (e.g., 60)
            hooks: getAddress(V4_POOL_HOOKS_RAW),
        };
        
        console.log(`Fetching dynamic fee from hook: ${V4_POOL_HOOKS_RAW} with PoolKey:`, poolKeyArgument);

        const dynamicFee = await publicClient.readContract({
            address: getAddress(V4_POOL_HOOKS_RAW),
            abi: hookAbi,
            functionName: 'getDynamicFee',
            args: [poolKeyArgument], // Pass the PoolKey struct as an array with one element
        });

        console.log("Dynamic fee fetched from hook:", dynamicFee);
        res.status(200).json({ dynamicFee: dynamicFee.toString() });

    } catch (error: any) {
        console.error("Error in /api/swap/get-dynamic-fee:", error);
        let errorMessage = "Failed to fetch dynamic fee.";
        // More detailed error logging from viem
        let errorDetails = error.shortMessage || error.message || "Unknown error";
        if (error.metaMessages) {
            errorDetails = error.metaMessages.join("; ") || errorDetails;
        }
        if (error.cause) { // Log the cause if present
            console.error("Cause:", error.cause);
            if (error.cause.shortMessage) {
                 errorDetails += ` (Cause: ${error.cause.shortMessage})`;
            }
        }
        res.status(500).json({ message: errorMessage, errorDetails: errorDetails });
    }
} 