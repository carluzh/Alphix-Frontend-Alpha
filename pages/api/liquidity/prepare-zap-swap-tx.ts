import type { NextApiRequest, NextApiResponse } from 'next';
import { Token } from '@uniswap/sdk-core';
import { V4Planner, Actions } from '@uniswap/v4-sdk';
import { RoutePlanner, CommandType } from '@uniswap/universal-router-sdk';
import { BigNumber } from 'ethers';
import type { Hex } from 'viem';
import { getAddress, parseUnits } from 'viem';

import { TokenSymbol, getToken, getPoolByTokens, getUniversalRouterAddress, createPoolKeyFromConfig } from '@/lib/pools-config';
import { publicClient } from '@/lib/viemClient';
import {
    PERMIT2_ADDRESS,
    Permit2Abi_allowance,
    PERMIT_EXPIRATION_DURATION_SECONDS,
    PERMIT_SIG_DEADLINE_DURATION_SECONDS
} from '@/lib/swap-constants';
import type { PoolKey } from '@uniswap/v4-sdk';

interface PrepareZapSwapTxRequest extends NextApiRequest {
    body: {
        userAddress: string;
        inputTokenSymbol: TokenSymbol;
        outputTokenSymbol: TokenSymbol;
        swapAmount: string;
        minOutputAmount: string;
        chainId: number;
        slippageTolerance?: number;
        deadlineSeconds?: number; // Transaction deadline in seconds (default: 1800 = 30 minutes)
        // Permit2 signature (if provided)
        permitSignature?: string;
        permitNonce?: number;
        permitExpiration?: number;
        permitSigDeadline?: string;
    };
}

interface ApprovalNeededResponse {
    needsApproval: true;
    approvalType: 'ERC20_TO_PERMIT2' | 'PERMIT2_SIGNATURE';

    // For ERC20_TO_PERMIT2
    approvalTokenAddress?: string;
    approvalTokenSymbol?: TokenSymbol;
    approveToAddress?: string;
    approvalAmount?: string;

    // For PERMIT2_SIGNATURE
    permitData?: {
        domain: {
            name: string;
            chainId: number;
            verifyingContract: string;
        };
        types: {
            PermitSingle: Array<{ name: string; type: string }>;
            PermitDetails: Array<{ name: string; type: string }>;
        };
        message: {
            details: {
                token: string;
                amount: string;
                expiration: number;
                nonce: number;
            };
            spender: string;
            sigDeadline: string;
        };
        primaryType: 'PermitSingle';
        // Backwards compatibility
        token: string;
        amount: string;
        nonce: number;
        expiration: number;
        sigDeadline: string;
        spender: string;
    };
}

interface TransactionPreparedResponse {
    needsApproval: false;
    transaction: {
        to: string;
        commands: string;
        inputs: string[];
        deadline: string;
        value: string;
    };
    swapDetails: {
        inputToken: TokenSymbol;
        outputToken: TokenSymbol;
        swapAmount: string;
        minOutputAmount: string;
    };
}

type PrepareZapSwapTxResponse = ApprovalNeededResponse | TransactionPreparedResponse;

export default async function handler(
    req: PrepareZapSwapTxRequest,
    res: NextApiResponse<PrepareZapSwapTxResponse | { error: string }>
) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const {
            userAddress,
            inputTokenSymbol,
            outputTokenSymbol,
            swapAmount,
            minOutputAmount,
            chainId,
            slippageTolerance = 50, // 0.5% default
            deadlineSeconds = 1800, // 30 minutes default (matches TX_DEADLINE_SECONDS)
            permitSignature,
            permitNonce,
            permitExpiration,
            permitSigDeadline,
        } = req.body;

        // Validate required fields
        if (!userAddress || !inputTokenSymbol || !outputTokenSymbol || !swapAmount || !minOutputAmount || !chainId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Get token configurations
        const inputTokenConfig = getToken(inputTokenSymbol);
        const outputTokenConfig = getToken(outputTokenSymbol);

        if (!inputTokenConfig || !outputTokenConfig) {
            return res.status(400).json({ error: 'Invalid token symbols' });
        }

        // Get pool configuration
        const poolConfig = getPoolByTokens(inputTokenSymbol, outputTokenSymbol);
        if (!poolConfig) {
            return res.status(400).json({ error: 'Pool not found for token pair' });
        }

        // Create SDK token instances
        const sdkInputToken = new Token(
            Number(chainId),
            getAddress(inputTokenConfig.address),
            inputTokenConfig.decimals,
            inputTokenConfig.symbol,
            inputTokenConfig.name
        );

        const sdkOutputToken = new Token(
            Number(chainId),
            getAddress(outputTokenConfig.address),
            outputTokenConfig.decimals,
            outputTokenConfig.symbol,
            outputTokenConfig.name
        );

        // Parse amounts
        const parsedSwapAmount = parseUnits(swapAmount, inputTokenConfig.decimals);
        const parsedMinOutput = parseUnits(minOutputAmount, outputTokenConfig.decimals);

        // Check if input is native ETH
        const isNativeInput = inputTokenConfig.address === '0x0000000000000000000000000000000000000000';

        // ========== STEP 1: Check ERC20 approval to Permit2 ==========
        if (!isNativeInput) {
            const erc20Allowance = await publicClient.readContract({
                address: getAddress(inputTokenConfig.address),
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

            if (erc20Allowance < parsedSwapAmount) {
                return res.status(200).json({
                    needsApproval: true,
                    approvalType: 'ERC20_TO_PERMIT2',
                    approvalTokenAddress: getAddress(inputTokenConfig.address),
                    approvalTokenSymbol: inputTokenSymbol,
                    approveToAddress: PERMIT2_ADDRESS,
                    approvalAmount: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' // max uint256
                });
            }
        }

        // ========== STEP 2: Check Permit2 allowance and request signature if needed ==========
        const now = Math.floor(Date.now() / 1000);
        const calculatedPermitExpiration = permitExpiration || now + PERMIT_EXPIRATION_DURATION_SECONDS;
        const calculatedPermitSigDeadline = permitSigDeadline || (now + PERMIT_SIG_DEADLINE_DURATION_SECONDS).toString();

        // Only check for permit if we don't have a signature yet
        if (!isNativeInput && !permitSignature) {
            const [amount, expiration, nonce] = await publicClient.readContract({
                address: PERMIT2_ADDRESS,
                abi: Permit2Abi_allowance,
                functionName: 'allowance',
                args: [
                    getAddress(userAddress),
                    getAddress(inputTokenConfig.address),
                    getUniversalRouterAddress()
                ]
            }) as readonly [bigint, number, number];

            const needsPermit = amount < parsedSwapAmount || expiration <= now;

            if (needsPermit) {
                const domain = {
                    name: 'Permit2',
                    chainId,
                    verifyingContract: PERMIT2_ADDRESS,
                };

                const types = {
                    PermitSingle: [
                        { name: 'details', type: 'PermitDetails' },
                        { name: 'spender', type: 'address' },
                        { name: 'sigDeadline', type: 'uint256' }
                    ],
                    PermitDetails: [
                        { name: 'token', type: 'address' },
                        { name: 'amount', type: 'uint160' },
                        { name: 'expiration', type: 'uint48' },
                        { name: 'nonce', type: 'uint48' }
                    ]
                };

                return res.status(200).json({
                    needsApproval: true,
                    approvalType: 'PERMIT2_SIGNATURE',
                    permitData: {
                        domain,
                        types,
                        message: {
                            details: {
                                token: getAddress(inputTokenConfig.address),
                                amount: parsedSwapAmount.toString(),
                                expiration: calculatedPermitExpiration,
                                nonce: Number(nonce),
                            },
                            spender: getUniversalRouterAddress(),
                            sigDeadline: calculatedPermitSigDeadline.toString(),
                        },
                        primaryType: 'PermitSingle' as const,
                        // Also include flat structure for backwards compatibility
                        token: getAddress(inputTokenConfig.address),
                        amount: parsedSwapAmount.toString(),
                        nonce: Number(nonce),
                        expiration: calculatedPermitExpiration,
                        sigDeadline: calculatedPermitSigDeadline.toString(),
                        spender: getUniversalRouterAddress(),
                    }
                });
            }
        }

        // ========== STEP 3: Build swap transaction ==========
        const v4PoolKey: PoolKey = createPoolKeyFromConfig(poolConfig);

        // Determine swap direction
        const zeroForOne = getAddress(sdkInputToken.address!) === v4PoolKey.currency0;

        // Build V4 swap actions
        const swapPlanner = new V4Planner();
        const currency0 = v4PoolKey.currency0;
        const currency1 = v4PoolKey.currency1;
        const inputCurrency = zeroForOne ? currency0 : currency1;
        const outputCurrency = zeroForOne ? currency1 : currency0;

        swapPlanner.addAction(Actions.SWAP_EXACT_IN_SINGLE, [{
            poolKey: v4PoolKey,
            zeroForOne,
            amountIn: BigNumber.from(parsedSwapAmount.toString()),
            amountOutMinimum: BigNumber.from(parsedMinOutput.toString()),
            sqrtPriceLimitX96: BigNumber.from('0'),
            hookData: '0x'
        }]);

        swapPlanner.addAction(Actions.SETTLE_ALL, [
            inputCurrency,
            BigNumber.from(parsedSwapAmount.toString()),
        ]);

        // Calculate minimum output with slippage
        const takeAllMin = (parsedMinOutput * BigInt(10000 - slippageTolerance)) / BigInt(10000);

        swapPlanner.addAction(Actions.TAKE_ALL, [
            outputCurrency,
            BigNumber.from(takeAllMin.toString())
        ]);

        const swapEncodedActions = swapPlanner.finalize() as Hex;

        // Build Universal Router transaction
        const routePlanner = new RoutePlanner();

        // Add PERMIT2_PERMIT command if we have signature
        if (!isNativeInput && permitSignature && permitNonce !== undefined && permitExpiration && permitSigDeadline) {
            routePlanner.addCommand(CommandType.PERMIT2_PERMIT, [
                [
                    [
                        getAddress(inputTokenConfig.address),
                        BigInt(parsedSwapAmount.toString()),
                        Number(permitExpiration),
                        Number(permitNonce)
                    ],
                    getUniversalRouterAddress(),
                    BigInt(permitSigDeadline.toString())
                ],
                permitSignature as Hex
            ]);
        }

        // Add V4_SWAP command
        routePlanner.addCommand(CommandType.V4_SWAP, [swapEncodedActions]);

        // Finalize transaction
        const { commands, inputs } = routePlanner;
        const deadline = BigInt(now + deadlineSeconds);
        const txValue = isNativeInput ? parsedSwapAmount.toString() : '0';

        return res.status(200).json({
            needsApproval: false,
            transaction: {
                to: getUniversalRouterAddress(),
                commands: commands as Hex,
                inputs: inputs as Hex[],
                deadline: deadline.toString(),
                value: txValue
            },
            swapDetails: {
                inputToken: inputTokenSymbol,
                outputToken: outputTokenSymbol,
                swapAmount: swapAmount,
                minOutputAmount: minOutputAmount,
            }
        });

    } catch (error: any) {
        console.error('[prepare-zap-swap-tx] Error:', error);
        return res.status(500).json({
            error: error.message || 'Failed to prepare zap swap transaction'
        });
    }
}
