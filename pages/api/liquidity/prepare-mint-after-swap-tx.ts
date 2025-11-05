/**
 * API endpoint for preparing mint transaction AFTER a swap has been completed in zap flow
 * This is similar to prepare-mint-tx but expects both token amounts as input
 * (user has both tokens in wallet after the swap transaction)
 */

import { Token, Percent, Ether } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position, V4PositionManager } from "@uniswap/v4-sdk";
import type { MintOptions } from "@uniswap/v4-sdk";
import { PermitBatch } from '@uniswap/permit2-sdk';
import { nearestUsableTick } from '@uniswap/v3-sdk';
import JSBI from 'jsbi';
import type { NextApiRequest, NextApiResponse } from 'next';

import { STATE_VIEW_ABI as STATE_VIEW_HUMAN_READABLE_ABI } from "@/lib/abis/state_view_abi";
import { TokenSymbol, getToken, getPositionManagerAddress, getStateViewAddress, getPoolByTokens } from "../../../lib/pools-config";
import { PERMIT2_TYPES } from "../../../lib/liquidity-utils";
import { AllowanceTransfer, PERMIT2_ADDRESS } from '@uniswap/permit2-sdk';

import { publicClient } from "../../../lib/viemClient";
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

const POSITION_MANAGER_ADDRESS = getPositionManagerAddress();
const STATE_VIEW_ADDRESS = getStateViewAddress();
const ETHERS_ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";
const SDK_MIN_TICK = -887272;
const SDK_MAX_TICK = 887272;

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

interface TransactionPreparedResponse {
    needsApproval: false;
    transaction: {
        to: string;
        data: string;
        value: string;
    };
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
            permitSignature,
            permitBatchData,
        } = req.body;

        // Validate required fields
        if (!userAddress || !token0Symbol || !token1Symbol || !token0Amount || !token1Amount || !chainId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Get token configurations
        const token0Config = getToken(token0Symbol);
        const token1Config = getToken(token1Symbol);

        if (!token0Config || !token1Config) {
            return res.status(400).json({ error: 'Invalid token symbols' });
        }

        // Get pool configuration
        const poolConfig = getPoolByTokens(token0Symbol, token1Symbol);
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

        // ========== STEP 1: Check ERC20 approvals to Permit2 ==========
        // Check BOTH tokens and return the first one that needs approval
        let token0NeedsApproval = false;
        let token1NeedsApproval = false;

        if (!token0IsNative) {
            const token0Allowance = await publicClient.readContract({
                address: getAddress(token0Config.address),
                abi: [{
                    name: 'allowance',
                    type: 'function',
                    stateMutability: 'view',
                    inputs: [
                        { name: 'owner', type: 'address' },
                        { name: 'spender', type: 'address' }
                    ],
                    outputs: [{ name: '', type: 'uint256' }]
                }],
                functionName: 'allowance',
                args: [getAddress(userAddress), PERMIT2_ADDRESS]
            }) as bigint;

            token0NeedsApproval = token0Allowance < parsedToken0Amount;
        }

        if (!token1IsNative) {
            const token1Allowance = await publicClient.readContract({
                address: getAddress(token1Config.address),
                abi: [{
                    name: 'allowance',
                    type: 'function',
                    stateMutability: 'view',
                    inputs: [
                        { name: 'owner', type: 'address' },
                        { name: 'spender', type: 'address' }
                    ],
                    outputs: [{ name: '', type: 'uint256' }]
                }],
                functionName: 'allowance',
                args: [getAddress(userAddress), PERMIT2_ADDRESS]
            }) as bigint;

            token1NeedsApproval = token1Allowance < parsedToken1Amount;
        }

        // Return the first token that needs approval (if any)
        // This ensures we handle them one at a time in the flow
        if (token0NeedsApproval) {
            return res.status(200).json({
                needsApproval: true,
                approvalType: 'ERC20_TO_PERMIT2',
                approvalTokenAddress: getAddress(token0Config.address),
                approvalTokenSymbol: token0Symbol,
                approveToAddress: PERMIT2_ADDRESS,
                approvalAmount: maxUint256.toString(),
                // Include info about other token for UI display
                token1AlsoNeedsApproval: token1NeedsApproval,
            });
        }

        if (token1NeedsApproval) {
            return res.status(200).json({
                needsApproval: true,
                approvalType: 'ERC20_TO_PERMIT2',
                approvalTokenAddress: getAddress(token1Config.address),
                approvalTokenSymbol: token1Symbol,
                approveToAddress: PERMIT2_ADDRESS,
                approvalAmount: maxUint256.toString(),
                // Token0 already checked and doesn't need approval
                token1AlsoNeedsApproval: false,
            });
        }

        // ========== STEP 2: Check Permit2 allowances and request PermitBatch signature if needed ==========
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

            // Check token0 Permit2 allowance
            if (!token0IsNative) {
                const [amount, expiration, nonce] = await publicClient.readContract({
                    address: PERMIT2_ADDRESS,
                    abi: [{
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
                    }],
                    functionName: 'allowance',
                    args: [
                        getAddress(userAddress),
                        getAddress(token0Config.address),
                        POSITION_MANAGER_ADDRESS
                    ]
                }) as readonly [bigint, number, number];

                const needsPermit = amount < parsedToken0Amount || expiration <= now;
                if (needsPermit) {
                    permitDetails.push({
                        token: getAddress(token0Config.address),
                        amount: (parsedToken0Amount + 1n).toString(), // Add buffer like regular flow
                        expiration: permitExpiration.toString(),
                        nonce: nonce.toString()
                    });
                }
            }

            // Check token1 Permit2 allowance
            if (!token1IsNative) {
                const [amount, expiration, nonce] = await publicClient.readContract({
                    address: PERMIT2_ADDRESS,
                    abi: [{
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
                    }],
                    functionName: 'allowance',
                    args: [
                        getAddress(userAddress),
                        getAddress(token1Config.address),
                        POSITION_MANAGER_ADDRESS
                    ]
                }) as readonly [bigint, number, number];

                const needsPermit = amount < parsedToken1Amount || expiration <= now;
                if (needsPermit) {
                    permitDetails.push({
                        token: getAddress(token1Config.address),
                        amount: (parsedToken1Amount + 1n).toString(), // Add buffer like regular flow
                        expiration: permitExpiration.toString(),
                        nonce: nonce.toString()
                    });
                }
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

        // Get slot0 (price and tick)
        const slot0Result = await publicClient.readContract({
            address: STATE_VIEW_ADDRESS,
            abi: parseAbi(STATE_VIEW_HUMAN_READABLE_ABI),
            functionName: 'getSlot0',
            args: [poolId]
        }) as readonly [bigint, number, number, number];

        // Get liquidity
        const poolLiquidity = await publicClient.readContract({
            address: STATE_VIEW_ADDRESS,
            abi: parseAbi(STATE_VIEW_HUMAN_READABLE_ABI),
            functionName: 'getLiquidity',
            args: [poolId]
        }) as bigint;

        const sqrtPriceX96 = slot0Result[0];
        const currentTick = Number(slot0Result[1]);

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

        // ========== STEP 4: Build mint transaction ==========
        const now = Math.floor(Date.now() / 1000);
        const deadline = BigInt(now + 600); // 10 minutes

        let mintOptions: MintOptions = {
            slippageTolerance: new Percent(slippageTolerance, 10_000),
            deadline: deadline.toString(),
            recipient: getAddress(userAddress),
            hookData: '0x',
            useNative: hasNativeETH ? Ether.onChain(Number(chainId)) : undefined
        };

        // Add permit batch if signature is provided
        if (permitSignature && permitBatchData) {
            const permitBatchForSDK: any = {
                details: permitBatchData.values!.details.map((detail: any) => ({
                    token: getAddress(detail.token),
                    amount: BigInt(detail.amount),
                    expiration: BigInt(detail.expiration),
                    nonce: BigInt(detail.nonce),
                })),
                spender: getAddress(permitBatchData.values!.spender),
                sigDeadline: BigInt(permitBatchData.values!.sigDeadline),
            };

            mintOptions = {
                ...mintOptions,
                batchPermit: {
                    owner: getAddress(userAddress),
                    permitBatch: permitBatchForSDK,
                    signature: permitSignature,
                }
            };
        }

        const mintMethodParameters = V4PositionManager.addCallParameters(position, mintOptions);

        // Calculate transaction value (if native ETH is involved)
        const txValue = hasNativeETH
            ? (token0IsNative ? parsedToken0Amount : parsedToken1Amount).toString()
            : '0';

        return res.status(200).json({
            needsApproval: false,
            transaction: {
                to: POSITION_MANAGER_ADDRESS,
                data: mintMethodParameters.calldata,
                value: txValue
            },
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
        console.error('[prepare-mint-after-swap-tx] Error:', error);
        return res.status(500).json({
            error: error.message || 'Failed to prepare mint transaction'
        });
    }
}
