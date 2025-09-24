import { Token, Percent, Ether } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position, V4PositionManager } from "@uniswap/v4-sdk";
import type { RemoveLiquidityOptions } from "@uniswap/v4-sdk";
import { nearestUsableTick } from '@uniswap/v3-sdk';
import JSBI from 'jsbi';
import type { NextApiRequest, NextApiResponse } from 'next';

import { STATE_VIEW_ABI as STATE_VIEW_HUMAN_READABLE_ABI } from "@/lib/abis/state_view_abi";
import { TokenSymbol, getToken, getPositionManagerAddress, getStateViewAddress } from "../../../lib/pools-config";

import { publicClient } from "../../../lib/viemClient";
import {
    isAddress,
    getAddress,
    parseAbi,
    parseUnits,
    type Hex
} from "viem";

const POSITION_MANAGER_ADDRESS = getPositionManagerAddress();
const STATE_VIEW_ADDRESS = getStateViewAddress();
const ETHERS_ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";
const SDK_MIN_TICK = -887272;
const SDK_MAX_TICK = 887272;

interface PrepareDecreaseTxRequest extends NextApiRequest {
    body: {
        userAddress: string;
        tokenId: string | number;
        token0Symbol: TokenSymbol;
        token1Symbol: TokenSymbol;
        liquidityPercentage: number; // 0-100
        tickLower: number;
        tickUpper: number;
        chainId: number;
        collectFees?: boolean; // Whether to collect fees in addition to decreasing
    };
}

interface TransactionPreparedResponse {
    needsApproval: false;
    transaction: {
        to: string;
        data: string;
        value: string;
    };
    deadline: string;
    details: {
        token0: { address: string; symbol: TokenSymbol; amount: string; };
        token1: { address: string; symbol: TokenSymbol; amount: string; };
        liquidityRemoved: string;
        isFullBurn: boolean;
        feesCollected?: {
            token0: string;
            token1: string;
        };
    };
}

type PrepareDecreaseTxResponse = TransactionPreparedResponse | { message: string; error?: any };

export default async function handler(
    req: PrepareDecreaseTxRequest,
    res: NextApiResponse<PrepareDecreaseTxResponse>
) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
    }

    const stateViewAbiViem = parseAbi(STATE_VIEW_HUMAN_READABLE_ABI);

    try {
        const {
            userAddress,
            tokenId,
            token0Symbol,
            token1Symbol,
            liquidityPercentage,
            tickLower,
            tickUpper,
            chainId,
            collectFees = true
        } = req.body;

        if (!isAddress(userAddress)) {
            return res.status(400).json({ message: "Invalid userAddress." });
        }

        const token0Config = getToken(token0Symbol);
        const token1Config = getToken(token1Symbol);

        if (!token0Config || !token1Config) {
            return res.status(400).json({ message: "Invalid token symbol(s) provided." });
        }

        if (typeof liquidityPercentage !== 'number' || liquidityPercentage < 0 || liquidityPercentage > 100) {
            return res.status(400).json({ message: "liquidityPercentage must be between 0 and 100." });
        }

        if (typeof tickLower !== 'number' || typeof tickUpper !== 'number') {
            return res.status(400).json({ message: "tickLower and tickUpper must be numbers." });
        }

        const sdkToken0 = new Token(chainId, getAddress(token0Config.address), token0Config.decimals, token0Config.symbol);
        const sdkToken1 = new Token(chainId, getAddress(token1Config.address), token1Config.decimals, token1Config.symbol);

        // Use configured pool ID from pools.json
        const { getPoolByTokens } = await import('../../../lib/pools-config');
        const poolConfig = getPoolByTokens(token0Symbol, token1Symbol);

        if (!poolConfig) {
            return res.status(400).json({ message: `No pool configuration found for ${token0Symbol}/${token1Symbol}` });
        }

        const clampedTickLower = Math.max(tickLower, SDK_MIN_TICK);
        const clampedTickUpper = Math.min(tickUpper, SDK_MAX_TICK);
        let finalTickLower = nearestUsableTick(clampedTickLower, poolConfig.tickSpacing);
        let finalTickUpper = nearestUsableTick(clampedTickUpper, poolConfig.tickSpacing);

        if (finalTickLower >= finalTickUpper) {
            finalTickLower = finalTickUpper - poolConfig.tickSpacing;
        }

        const [sortedToken0, sortedToken1] = sdkToken0.sortsBefore(sdkToken1)
            ? [sdkToken0, sdkToken1]
            : [sdkToken1, sdkToken0];

        const poolId = V4Pool.getPoolId(
            sortedToken0,
            sortedToken1,
            poolConfig.fee,
            poolConfig.tickSpacing,
            getAddress(poolConfig.hooks) as `0x${string}`
        );

        // Query current pool state
        let currentSqrtPriceX96_JSBI: JSBI;
        let currentTick: number;
        let currentLiquidity: bigint;

        try {
            const [slot0, liquidity] = await Promise.all([
                publicClient.readContract({
                    address: STATE_VIEW_ADDRESS,
                    abi: stateViewAbiViem,
                    functionName: 'getSlot0',
                    args: [poolId as Hex]
                }) as Promise<readonly [bigint, number, number, number]>,
                publicClient.readContract({
                    address: STATE_VIEW_ADDRESS,
                    abi: stateViewAbiViem,
                    functionName: 'getLiquidity',
                    args: [poolId as Hex]
                }) as Promise<bigint>
            ]);

            const sqrtPriceX96Current = slot0[0] as bigint;
            currentTick = slot0[1] as number;
            currentLiquidity = liquidity as bigint;
            currentSqrtPriceX96_JSBI = JSBI.BigInt(sqrtPriceX96Current.toString());

            if (sqrtPriceX96Current === 0n) {
                return res.status(400).json({
                    message: `Pool ${token0Symbol}/${token1Symbol} is not initialized.`
                });
            }

        } catch (error) {
            console.error("API Error (prepare-decrease-tx) fetching pool data:", error);
            return res.status(500).json({ message: "Failed to fetch current pool data.", error });
        }

        // Use NativeCurrency for the native leg to satisfy SDK native handling
        const poolCurrency0 = sortedToken0.address === ETHERS_ADDRESS_ZERO ? Ether.onChain(Number(chainId)) : sortedToken0;
        const poolCurrency1 = sortedToken1.address === ETHERS_ADDRESS_ZERO ? Ether.onChain(Number(chainId)) : sortedToken1;

        const v4Pool = new V4Pool(
            poolCurrency0 as any,
            poolCurrency1 as any,
            poolConfig.fee,
            poolConfig.tickSpacing,
            poolConfig.hooks as `0x${string}`,
            currentSqrtPriceX96_JSBI,
            JSBI.BigInt(currentLiquidity.toString()),
            currentTick
        );

        // For decreasing, we need to know the current position's liquidity
        // This would typically come from position data, but for now we'll use a placeholder
        // In a real implementation, you'd query the position's current liquidity from the NFT
        const positionLiquidity = JSBI.BigInt("1000000000000000000"); // Placeholder - should be queried

        const position = new V4Position({
            pool: v4Pool,
            liquidity: positionLiquidity,
            tickLower: finalTickLower,
            tickUpper: finalTickUpper
        });

        // Calculate liquidity to remove based on percentage
        const isFullBurn = liquidityPercentage >= 100;
        const liquidityToRemove = isFullBurn
            ? positionLiquidity
            : JSBI.divide(
                JSBI.multiply(positionLiquidity, JSBI.BigInt(Math.floor(liquidityPercentage))),
                JSBI.BigInt(100)
            );

        // Calculate amounts that will be received
        const { amount0, amount1 } = position.burnAmountsWithSlippage(
            liquidityToRemove,
            new Percent(50, 10_000) // 0.5% slippage tolerance
        );

        // Calculate deadline for transaction
        const latestBlockViem = await publicClient.getBlock({ blockTag: 'latest' });
        if (!latestBlockViem) throw new Error("Failed to get latest block for deadline.");
        const deadlineBigInt = latestBlockViem.timestamp + 1200n; // 20 minutes from now

        // Check if we have native ETH
        const hasNativeETH = sortedToken0.address === ETHERS_ADDRESS_ZERO || sortedToken1.address === ETHERS_ADDRESS_ZERO;

        // Create RemoveLiquidityOptions for V4PositionManager
        const removeOptions: RemoveLiquidityOptions = {
            tokenId: BigInt(tokenId.toString()),
            liquidityPercentage: new Percent(liquidityPercentage, 100),
            slippageTolerance: new Percent(50, 10_000), // 0.5% slippage
            deadline: deadlineBigInt.toString(),
            burnToken: isFullBurn,
            collectOptions: collectFees ? {
                expectedCurrencyOwed0: amount0,
                expectedCurrencyOwed1: amount1,
                recipient: getAddress(userAddress)
            } : undefined,
            // Always set when the pool involves the native token
            useNative: hasNativeETH ? Ether.onChain(Number(chainId)) : undefined
        };

        console.log(`[DEBUG] Preparing decrease transaction for ${token0Symbol}/${token1Symbol}`);
        console.log(`[DEBUG] Liquidity percentage: ${liquidityPercentage}%, Full burn: ${isFullBurn}`);

        // Use V4PositionManager to generate the complete call parameters
        const methodParameters = V4PositionManager.removeCallParameters(position, removeOptions);

        const encodedCallDataViem = methodParameters.calldata;
        const transactionValue = methodParameters.value ?? "0";

        console.log(`[DEBUG] Decrease transaction ready for ${token0Symbol}/${token1Symbol}`);

        return res.status(200).json({
            needsApproval: false,
            transaction: {
                to: POSITION_MANAGER_ADDRESS,
                data: encodedCallDataViem,
                value: transactionValue
            },
            deadline: deadlineBigInt.toString(),
            details: {
                token0: {
                    address: sortedToken0.address,
                    symbol: (getToken(sortedToken0.symbol as TokenSymbol)?.symbol || sortedToken0.symbol) as TokenSymbol,
                    amount: amount0.toString()
                },
                token1: {
                    address: sortedToken1.address,
                    symbol: (getToken(sortedToken1.symbol as TokenSymbol)?.symbol || sortedToken1.symbol) as TokenSymbol,
                    amount: amount1.toString()
                },
                liquidityRemoved: liquidityToRemove.toString(),
                isFullBurn,
                ...(collectFees && {
                    feesCollected: {
                        token0: amount0.toString(),
                        token1: amount1.toString()
                    }
                })
            }
        });

    } catch (error: any) {
        console.error("[API prepare-decrease-tx] Error:", error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
        const errorDetails = process.env.NODE_ENV === 'development' && error instanceof Error ? { name: error.name, stack: error.stack, cause: error.cause } : {};
        return res.status(500).json({ message: errorMessage, error: errorDetails });
    }
}