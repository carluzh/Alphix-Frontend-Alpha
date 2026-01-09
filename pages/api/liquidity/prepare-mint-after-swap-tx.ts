/**
 * API endpoint for preparing mint transaction AFTER a swap has been completed in zap flow
 * This is similar to prepare-mint-tx but expects both token amounts as input
 * (user has both tokens in wallet after the swap transaction)
 */

import { Token, Percent, Ether } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position, V4PositionManager } from "@uniswap/v4-sdk";
import type { MintOptions } from "@uniswap/v4-sdk";
import { PermitBatch } from '@uniswap/permit2-sdk';
import { nearestUsableTick, TickMath } from '@uniswap/v3-sdk';
import JSBI from 'jsbi';
import type { NextApiRequest, NextApiResponse } from 'next';

import { STATE_VIEW_ABI as STATE_VIEW_HUMAN_READABLE_ABI } from "@/lib/abis/state_view_abi";
import { TokenSymbol, getToken, getPositionManagerAddress, getStateViewAddress, getPoolByTokens, getNetworkModeFromRequest } from "../../../lib/pools-config";
import { PERMIT2_TYPES } from "../../../lib/liquidity-utils";
import { AllowanceTransfer, PERMIT2_ADDRESS } from '@uniswap/permit2-sdk';

import { createNetworkClient } from "../../../lib/viemClient";
import {
    isAddress,
    getAddress,
    parseAbi,
    maxUint256,
    parseUnits,
    type Hex
} from "viem";

import {
    PERMIT_EXPIRATION_DURATION_SECONDS,
    PERMIT_SIG_DEADLINE_DURATION_SECONDS,
} from "../../../lib/swap-constants";

// Note: POSITION_MANAGER_ADDRESS and STATE_VIEW_ADDRESS are now fetched dynamically per-request
// using getPositionManagerAddress(networkMode) and getStateViewAddress(networkMode)
const ETHERS_ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";

interface PrepareMintAfterSwapTxRequest extends NextApiRequest {
    body: {
        userAddress: string;
        token0Symbol: TokenSymbol;
        token1Symbol: TokenSymbol;
        token0Amount: string; // Amount of token0 user has
        token1Amount: string; // Amount of token1 user has (from swap output)
        userTickLower: number;
        userTickUpper: number;
        chainId: number;
        slippageTolerance?: number;
        deadlineSeconds?: number; // Transaction deadline in seconds (default: 1800 = 30 minutes)
        permitSignature?: string;
        permitBatchData?: {
            domain?: {
                name: string;
                chainId: number;
                verifyingContract: string;
            };
            types?: any;
            values?: {
                details: Array<{
                    token: string;
                    amount: string;
                    expiration: string;
                    nonce: string;
                }>;
                spender: string;
                sigDeadline: string;
            };
            details?: Array<{
                token: string;
                amount: string;
                expiration: string;
                nonce: string;
            }>;
            spender?: string;
            sigDeadline?: string;
        };
    };
}

interface ApprovalNeededResponse {
    needsApproval: true;
    approvalType: 'ERC20_TO_PERMIT2' | 'PERMIT2_BATCH_SIGNATURE';

    // For ERC20_TO_PERMIT2
    approvalTokenAddress?: string;
    approvalTokenSymbol?: TokenSymbol;
    approveToAddress?: string;
    approvalAmount?: string;

    // For PERMIT2_BATCH_SIGNATURE
    permitBatchData?: {
        domain: {
            name: string;
            chainId: number;
            verifyingContract: string;
        };
        types: any;
        message: {
            details: Array<{
                token: string;
                amount: string;
                expiration: string;
                nonce: string;
            }>;
            spender: string;
            sigDeadline: string;
        };
        primaryType: 'PermitBatch';
        // Backwards compatibility
        values?: {
            details: Array<{
                token: string;
                amount: string;
                expiration: string;
                nonce: string;
            }>;
            spender: string;
            sigDeadline: string;
        };
    };
}

// Uniswap-compatible response format (mirrors CreateLPPositionResponse from Trading API)
interface TransactionPreparedResponse {
    needsApproval: false;
    // Primary transaction field - matches Uniswap's 'create' field
    create: {
        to: string;
        from?: string;
        data: string;
        value: string;
        chainId: number;
    };
    // Backwards compatibility - same as 'create'
    transaction: {
        to: string;
        data: string;
        value: string;
    };
    // Pool state (matches Uniswap)
    sqrtRatioX96: string;
    currentTick: number;
    poolLiquidity: string;
    details: {
        token0: { address: string; symbol: TokenSymbol; amount: string };
        token1: { address: string; symbol: TokenSymbol; amount: string };
        liquidity: string;
        tickLower: number;
        tickUpper: number;
    };
}

type PrepareMintAfterSwapTxResponse = ApprovalNeededResponse | TransactionPreparedResponse;

export default async function handler(
    req: PrepareMintAfterSwapTxRequest,
    res: NextApiResponse<PrepareMintAfterSwapTxResponse | { error: string }>
) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Get network mode from cookies and create network-specific resources
    const networkMode = getNetworkModeFromRequest(req.headers.cookie);
    console.log('[prepare-mint-after-swap-tx] Network mode from cookies:', networkMode);
    const publicClient = createNetworkClient(networkMode);
    const POSITION_MANAGER_ADDRESS = getPositionManagerAddress(networkMode);
    const STATE_VIEW_ADDRESS = getStateViewAddress(networkMode);

    try {
        const {
            userAddress,
            token0Symbol,
            token1Symbol,
            token0Amount,
            token1Amount,
            userTickLower,
            userTickUpper,
            chainId,
            slippageTolerance = 50, // 0.5% default
            deadlineSeconds = 1800, // 30 minutes default (matches TX_DEADLINE_SECONDS)
            permitSignature,
            permitBatchData,
        } = req.body;

        console.log('[prepare-mint-after-swap-tx] Request received:', {
            userAddress,
            token0Symbol,
            token1Symbol,
            token0Amount,
            token1Amount,
            userTickLower,
            userTickUpper,
            chainId,
            hasPermitSignature: !!permitSignature,
            hasPermitBatchData: !!permitBatchData,
            permitBatchDataStructure: permitBatchData ? {
                hasMessage: !!(permitBatchData as any).message,
                hasValues: !!permitBatchData.values,
                keys: Object.keys(permitBatchData),
            } : null,
        });

        // Validate required fields
        if (!userAddress || !token0Symbol || !token1Symbol || !token0Amount || !token1Amount || !chainId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Get token configurations
        const token0Config = getToken(token0Symbol, networkMode);
        const token1Config = getToken(token1Symbol, networkMode);

        if (!token0Config || !token1Config) {
            return res.status(400).json({ error: 'Invalid token symbols' });
        }

        // Get pool configuration
        const poolConfig = getPoolByTokens(token0Symbol, token1Symbol, networkMode);
        if (!poolConfig) {
            return res.status(400).json({ error: 'Pool not found for token pair' });
        }

        // Parse amounts
        const parsedToken0Amount = parseUnits(token0Amount, token0Config.decimals);
        const parsedToken1Amount = parseUnits(token1Amount, token1Config.decimals);

        // Check if either token is native ETH
        const token0IsNative = token0Config.address === ETHERS_ADDRESS_ZERO;
        const token1IsNative = token1Config.address === ETHERS_ADDRESS_ZERO;
        const hasNativeETH = token0IsNative || token1IsNative;

        // ZAP MODE: Skip all approval checks - the frontend handles approvals independently
        // We proceed directly to permit signature checking

        // ========== Check Permit2 allowances and request PermitBatch signature if needed ==========
        if (!permitSignature) {
            const now = Math.floor(Date.now() / 1000);
            const permitExpiration = now + PERMIT_EXPIRATION_DURATION_SECONDS;
            const permitSigDeadline = now + PERMIT_SIG_DEADLINE_DURATION_SECONDS;

            const permitDetails: Array<{
                token: string;
                amount: string;
                expiration: string;
                nonce: string;
            }> = [];

            // Build list of non-native tokens to check
            const tokensToCheck = [
                { config: token0Config, parsedAmount: parsedToken0Amount, isNative: token0IsNative },
                { config: token1Config, parsedAmount: parsedToken1Amount, isNative: token1IsNative }
            ].filter(t => !t.isNative);

            if (tokensToCheck.length > 0) {
                const permit2AllowanceAbi = [{
                    name: 'allowance',
                    type: 'function',
                    stateMutability: 'view',
                    inputs: [
                        { name: 'owner', type: 'address' },
                        { name: 'token', type: 'address' },
                        { name: 'spender', type: 'address' }
                    ],
                    outputs: [
                        { name: 'amount', type: 'uint160' },
                        { name: 'expiration', type: 'uint48' },
                        { name: 'nonce', type: 'uint48' }
                    ]
                }] as const;

                // Batch all Permit2 allowance checks into single multicall
                const permit2Results = await publicClient.multicall({
                    contracts: tokensToCheck.map(t => ({
                        address: PERMIT2_ADDRESS as `0x${string}`,
                        abi: permit2AllowanceAbi,
                        functionName: 'allowance' as const,
                        args: [
                            getAddress(userAddress),
                            getAddress(t.config.address),
                            POSITION_MANAGER_ADDRESS
                        ] as const
                    })),
                    allowFailure: false,
                });

                // Process results
                tokensToCheck.forEach((t, i) => {
                    const [amount, expiration, nonce] = permit2Results[i] as readonly [bigint, number, number];
                    const needsPermit = amount < t.parsedAmount || expiration <= now;
                    if (needsPermit) {
                        permitDetails.push({
                            token: getAddress(t.config.address),
                            amount: (t.parsedAmount + 1n).toString(), // Add buffer like regular flow
                            expiration: permitExpiration.toString(),
                            nonce: nonce.toString()
                        });
                    }
                });
            }

            // If any token needs permit, request PermitBatch signature
            if (permitDetails.length > 0) {
                const domain = {
                    name: 'Permit2',
                    chainId,
                    verifyingContract: PERMIT2_ADDRESS,
                };

                return res.status(200).json({
                    needsApproval: true,
                    approvalType: 'PERMIT2_BATCH_SIGNATURE',
                    permitBatchData: {
                        domain,
                        types: PERMIT2_TYPES,
                        message: {
                            details: permitDetails,
                            spender: POSITION_MANAGER_ADDRESS,
                            sigDeadline: permitSigDeadline.toString()
                        },
                        primaryType: 'PermitBatch' as const,
                        // Also include old format for backwards compatibility
                        values: {
                            details: permitDetails,
                            spender: POSITION_MANAGER_ADDRESS,
                            sigDeadline: permitSigDeadline.toString()
                        }
                    }
                });
            }
        }

        // ========== STEP 3: Fetch pool state and create position ==========
        // Create pool ID from pool key
        const poolId = poolConfig.subgraphId as `0x${string}`;
        const stateViewAbi = parseAbi(STATE_VIEW_HUMAN_READABLE_ABI);

        // Batch pool state reads into single multicall
        const [slot0Result, liquidityResult] = await publicClient.multicall({
            contracts: [
                {
                    address: STATE_VIEW_ADDRESS,
                    abi: stateViewAbi,
                    functionName: 'getSlot0',
                    args: [poolId]
                },
                {
                    address: STATE_VIEW_ADDRESS,
                    abi: stateViewAbi,
                    functionName: 'getLiquidity',
                    args: [poolId]
                }
            ],
            allowFailure: false,
        });

        const slot0 = slot0Result as readonly [bigint, number, number, number];
        const poolLiquidity = liquidityResult as bigint;

        const sqrtPriceX96 = slot0[0];
        const currentTick = Number(slot0[1]);

        // Create SDK token instances
        const sdkToken0 = new Token(
            Number(chainId),
            getAddress(token0Config.address),
            token0Config.decimals,
            token0Config.symbol,
            token0Config.name
        );

        const sdkToken1 = new Token(
            Number(chainId),
            getAddress(token1Config.address),
            token1Config.decimals,
            token1Config.symbol,
            token1Config.name
        );

        // Create V4 pool
        const v4Pool = new V4Pool(
            sdkToken0,
            sdkToken1,
            poolConfig.fee,
            poolConfig.tickSpacing,
            getAddress(poolConfig.hooks),
            JSBI.BigInt(sqrtPriceX96.toString()),
            JSBI.BigInt(poolLiquidity.toString()),
            currentTick,
            []
        );

        // Ensure ticks are valid
        const tickLower = nearestUsableTick(userTickLower, poolConfig.tickSpacing);
        const tickUpper = nearestUsableTick(userTickUpper, poolConfig.tickSpacing);

        // Create position from amounts
        const position = V4Position.fromAmounts({
            pool: v4Pool,
            tickLower,
            tickUpper,
            amount0: parsedToken0Amount.toString(),
            amount1: parsedToken1Amount.toString(),
            useFullPrecision: true
        });

        console.log('[prepare-mint-after-swap-tx] Position created:', {
            liquidity: position.liquidity.toString(),
            amount0: parsedToken0Amount.toString(),
            amount1: parsedToken1Amount.toString(),
            tickLower,
            tickUpper,
            currentTick,
            isOOR: currentTick < tickLower || currentTick > tickUpper,
        });

        // ========== STEP 4: Build mint transaction ==========
        const now = Math.floor(Date.now() / 1000);
        const deadline = BigInt(now + deadlineSeconds);

        let mintOptions: MintOptions = {
            slippageTolerance: new Percent(slippageTolerance, 10_000),
            deadline: deadline.toString(),
            recipient: getAddress(userAddress),
            hookData: '0x',
            useNative: hasNativeETH ? Ether.onChain(Number(chainId)) : undefined
        };

        // Add permit batch if signature is provided
        if (permitSignature && permitBatchData) {
            // Handle both message (new format) and values (backwards compat) formats
            const permitValues = (permitBatchData as any).message || permitBatchData.values;
            
            if (!permitValues || !permitValues.details || !Array.isArray(permitValues.details)) {
                console.error('[prepare-mint-after-swap-tx] Invalid permitBatchData structure:', {
                    hasMessage: !!(permitBatchData as any).message,
                    hasValues: !!permitBatchData.values,
                    permitBatchDataKeys: Object.keys(permitBatchData),
                    permitValuesKeys: permitValues ? Object.keys(permitValues) : null,
                });
                throw new Error('Invalid permit batch data structure: missing details array');
            }

            if (!permitValues.spender || !permitValues.sigDeadline) {
                console.error('[prepare-mint-after-swap-tx] Missing required permit fields:', {
                    hasSpender: !!permitValues.spender,
                    hasSigDeadline: !!permitValues.sigDeadline,
                });
                throw new Error('Invalid permit batch data: missing spender or sigDeadline');
            }

            console.log('[prepare-mint-after-swap-tx] Processing permit batch:', {
                detailsCount: permitValues.details.length,
                spender: permitValues.spender,
                sigDeadline: permitValues.sigDeadline,
                usingFormat: (permitBatchData as any).message ? 'message' : 'values',
            });

            const permitBatchForSDK: any = {
                details: permitValues.details.map((detail: any) => {
                    if (!detail.token || detail.amount === undefined || detail.expiration === undefined || detail.nonce === undefined) {
                        console.error('[prepare-mint-after-swap-tx] Invalid permit detail:', detail);
                        throw new Error('Invalid permit detail structure');
                    }
                    const parsedDetail = {
                        token: getAddress(detail.token),
                        amount: BigInt(detail.amount),
                        expiration: BigInt(detail.expiration),
                        nonce: BigInt(detail.nonce),
                    };
                    console.log('[prepare-mint-after-swap-tx] Parsed permit detail:', {
                        token: parsedDetail.token,
                        amount: parsedDetail.amount.toString(),
                        expiration: parsedDetail.expiration.toString(),
                        nonce: parsedDetail.nonce.toString(),
                    });
                    return parsedDetail;
                }),
                spender: getAddress(permitValues.spender),
                sigDeadline: BigInt(permitValues.sigDeadline),
            };

            console.log('[prepare-mint-after-swap-tx] Final permitBatchForSDK:', {
                detailsCount: permitBatchForSDK.details.length,
                spender: permitBatchForSDK.spender,
                sigDeadline: permitBatchForSDK.sigDeadline.toString(),
                signatureLength: permitSignature.length,
                signaturePrefix: permitSignature.slice(0, 10),
            });

            mintOptions = {
                ...mintOptions,
                batchPermit: {
                    owner: getAddress(userAddress),
                    permitBatch: permitBatchForSDK,
                    signature: permitSignature,
                }
            };

            console.log('[prepare-mint-after-swap-tx] Mint options before SDK call:', {
                hasBatchPermit: !!mintOptions.batchPermit,
                batchPermitOwner: mintOptions.batchPermit?.owner,
                batchPermitDetailsCount: mintOptions.batchPermit?.permitBatch?.details?.length,
                hasSignature: !!mintOptions.batchPermit?.signature,
                positionLiquidity: position.liquidity.toString(),
                tickLower,
                tickUpper,
                token0Amount: parsedToken0Amount.toString(),
                token1Amount: parsedToken1Amount.toString(),
                permitAmounts: permitBatchForSDK.details.map((d: any) => ({
                    token: d.token,
                    amount: d.amount.toString(),
                })),
            });
        }

        console.log('[prepare-mint-after-swap-tx] Calling V4PositionManager.addCallParameters...');
        let mintMethodParameters;
        try {
            mintMethodParameters = V4PositionManager.addCallParameters(position, mintOptions);
            console.log('[prepare-mint-after-swap-tx] SDK call succeeded');
        } catch (sdkError: any) {
            console.error('[prepare-mint-after-swap-tx] SDK call failed:', {
                error: sdkError.message,
                stack: sdkError.stack,
                mintOptions: JSON.stringify(mintOptions, (key, value) => {
                    if (typeof value === 'bigint') return value.toString();
                    return value;
                }, 2),
            });
            throw sdkError;
        }

        // Calculate transaction value (if native ETH is involved)
        const txValue = hasNativeETH
            ? (token0IsNative ? parsedToken0Amount : parsedToken1Amount).toString()
            : '0';

        // Response format aligned with Uniswap Trading API CreateLPPositionResponse
        return res.status(200).json({
            needsApproval: false,
            // Uniswap-style 'create' field
            create: {
                to: POSITION_MANAGER_ADDRESS,
                from: getAddress(userAddress),
                data: mintMethodParameters.calldata,
                value: txValue,
                chainId: chainId,
            },
            // Backwards compatibility
            transaction: {
                to: POSITION_MANAGER_ADDRESS,
                data: mintMethodParameters.calldata,
                value: txValue
            },
            // Pool state (matches Uniswap response)
            sqrtRatioX96: sqrtPriceX96.toString(),
            currentTick,
            poolLiquidity: poolLiquidity.toString(),
            details: {
                token0: {
                    address: getAddress(token0Config.address),
                    symbol: token0Symbol,
                    amount: parsedToken0Amount.toString()
                },
                token1: {
                    address: getAddress(token1Config.address),
                    symbol: token1Symbol,
                    amount: parsedToken1Amount.toString()
                },
                liquidity: position.liquidity.toString(),
                tickLower,
                tickUpper
            }
        });

    } catch (error: any) {
        console.error('[prepare-mint-after-swap-tx] Error:', {
            message: error.message,
            stack: error.stack,
            name: error.name,
            ...(error.cause && { cause: error.cause }),
        });
        return res.status(500).json({
            error: error.message || 'Failed to prepare mint transaction'
        });
    }
}
