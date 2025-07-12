import type { NextApiRequest, NextApiResponse } from 'next';
import { getAddress, type Address } from 'viem';
import { publicClient } from '../../../lib/viemClient';
import { getToken, createTokenSDK, getPoolByTokens } from '../../../lib/pools-config';
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

        // Find the pool configuration for this token pair
        const poolConfig = getPoolByTokens(fromTokenSymbol, toTokenSymbol);
        if (!poolConfig) {
            return res.status(400).json({ message: `No pool found for token pair ${fromTokenSymbol}/${toTokenSymbol}` });
        }

        const tokenA = createTokenSDK(fromTokenSymbol, Number(chainId));
        const tokenB = createTokenSDK(toTokenSymbol, Number(chainId));
        
        if (!tokenA || !tokenB) {
            return res.status(400).json({ message: 'Failed to create token instances.' });
        }

        const token0ForPoolKey = tokenA.sortsBefore(tokenB) ? tokenA : tokenB;
        const token1ForPoolKey = tokenA.sortsBefore(tokenB) ? tokenB : tokenA;

        // Construct the PoolKey struct argument using actual pool configuration
        const poolKeyArgument = {
            currency0: getAddress(token0ForPoolKey.address),
            currency1: getAddress(token1ForPoolKey.address),
            fee: DYNAMIC_FEE_FLAG, // Use the DYNAMIC_FEE_FLAG to indicate we want dynamic fee
            tickSpacing: poolConfig.tickSpacing, // Use actual pool tick spacing
            hooks: getAddress(poolConfig.hooks), // Use actual pool hooks address
        };
        
        console.log(`Fetching dynamic fee for pool ${poolConfig.id} with PoolKey:`, poolKeyArgument);

        const dynamicFee = await publicClient.readContract({
            address: getAddress(poolConfig.hooks), // Use the pool's hook address
            abi: hookAbi,
            functionName: 'getDynamicFee',
            args: [poolKeyArgument], // Pass the PoolKey struct as an array with one element
        });

        console.log(`Dynamic fee fetched for pool ${poolConfig.id}:`, dynamicFee);
        res.status(200).json({ 
            dynamicFee: dynamicFee.toString(),
            poolId: poolConfig.id,
            poolName: poolConfig.name 
        });

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