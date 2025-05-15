import type { NextApiRequest, NextApiResponse } from 'next';
import { Token } from '@uniswap/sdk-core';
import {
    prepareAddLiquidityTx,
    prepareDecreaseLiquidityTx,
    prepareCollectLiquidityTx,
    type AddLiquidityParams,
    type RemoveLiquidityParams,
    type CollectLiquidityParams
} from '../../../lib/liquidity-utils';
import { CHAIN_ID, TOKEN_DEFINITIONS } from '../../../lib/swap-constants'; // Using existing constants
import { getAddress, type Address, type Hex } from 'viem';

interface SuccessResponse {
    message: string;
    tx?: { to: Address; data: Hex; value: string };
    txs?: Array<{ to: Address; data: Hex; value: string }>; // For operations that might need multiple txs
}

interface ErrorResponse {
    message: string;
    error?: any;
}

// Helper to convert bigint to string for JSON serialization in tx objects
function stringifyTx(tx: { to: Address; data: Hex; value: bigint }): { to: Address; data: Hex; value: string } {
    return { ...tx, value: tx.value.toString() };
}

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse<SuccessResponse | ErrorResponse>
) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
    }

    const { action, params } = req.body;
    const userAddress = req.body.userAddress as Address; // Assuming userAddress is sent in body

    if (!userAddress || !getAddress(userAddress)) {
        return res.status(400).json({ message: 'Valid userAddress is required in the request body.'});
    }

    try {
        switch (action) {
            case 'addLiquidity':
                const addParams = params as AddLiquidityParams;
                // Reconstruct Token objects as they are not directly JSON serializable with methods
                const token0Config = TOKEN_DEFINITIONS[addParams.token0.symbol as keyof typeof TOKEN_DEFINITIONS];
                const token1Config = TOKEN_DEFINITIONS[addParams.token1.symbol as keyof typeof TOKEN_DEFINITIONS];

                if (!token0Config || !token1Config) {
                    return res.status(400).json({ message: 'Invalid token symbols in params.' });
                }

                const token0 = new Token(CHAIN_ID, getAddress(token0Config.addressRaw), token0Config.decimals, token0Config.symbol);
                const token1 = new Token(CHAIN_ID, getAddress(token1Config.addressRaw), token1Config.decimals, token1Config.symbol);
                
                const finalAddParams: AddLiquidityParams = {
                    ...addParams,
                    userAddress: getAddress(userAddress),
                    token0,
                    token1,
                    // sqrtPriceX96 needs to be bigint. Client should send as string then parse here if needed.
                    sqrtPriceX96: addParams.sqrtPriceX96 ? BigInt(addParams.sqrtPriceX96 as any) : undefined,
                };
                const addTx = await prepareAddLiquidityTx(finalAddParams);
                return res.status(200).json({ message: 'Add liquidity transaction prepared.', tx: stringifyTx(addTx) });

            case 'decreaseLiquidity':
                const decreaseParams = params as RemoveLiquidityParams;
                const finalDecreaseParams: RemoveLiquidityParams = {
                    ...decreaseParams,
                    userAddress: getAddress(userAddress),
                    tokenId: BigInt(decreaseParams.tokenId as any),
                    liquidityToRemove: BigInt(decreaseParams.liquidityToRemove as any),
                    amount0MinReturn: BigInt(decreaseParams.amount0MinReturn as any),
                    amount1MinReturn: BigInt(decreaseParams.amount1MinReturn as any),
                };
                const decreaseTx = await prepareDecreaseLiquidityTx(finalDecreaseParams);
                return res.status(200).json({ message: 'Decrease liquidity transaction prepared.', tx: stringifyTx(decreaseTx) });

            case 'collectLiquidity':
                const collectParams = params as CollectLiquidityParams;
                 const finalCollectParams: CollectLiquidityParams = {
                    ...collectParams,
                    userAddress: getAddress(userAddress),
                    tokenId: BigInt(collectParams.tokenId as any),
                    amount0CollectMax: collectParams.amount0CollectMax ? BigInt(collectParams.amount0CollectMax as any) : undefined,
                    amount1CollectMax: collectParams.amount1CollectMax ? BigInt(collectParams.amount1CollectMax as any) : undefined,
                };
                const collectTx = await prepareCollectLiquidityTx(finalCollectParams);
                return res.status(200).json({ message: 'Collect liquidity transaction prepared.', tx: stringifyTx(collectTx) });

            default:
                return res.status(400).json({ message: 'Invalid action specified.' });
        }
    } catch (error: any) {
        console.error(`Error in /api/liquidity/manage for action ${action}:`, error);
        return res.status(500).json({
            message: error.message || 'Failed to prepare liquidity transaction.',
            error: error.toString(), // Or more detailed error serialization if needed
        });
    }
} 