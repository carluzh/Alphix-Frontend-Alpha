import { Token, Percent, Ether } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position, V4PositionManager } from "@uniswap/v4-sdk";
import type { MintOptions, AllowanceTransferPermitBatch } from "@uniswap/v4-sdk";
import { nearestUsableTick } from '@uniswap/v3-sdk';
import JSBI from 'jsbi';
import type { NextApiRequest, NextApiResponse } from 'next';

import { STATE_VIEW_ABI as STATE_VIEW_HUMAN_READABLE_ABI } from "@/lib/abis/state_view_abi";
import { TokenSymbol, getToken, getPositionManagerAddress, getStateViewAddress, getNetworkModeFromRequest } from "../../../lib/pools-config";
import { validateChainId, checkTxRateLimit } from "../../../lib/tx-validation";
import { iallowance_transfer_abi } from "../../../lib/abis/IAllowanceTransfer_abi"; // For Permit2 allowance method

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
import { PERMIT2_TYPES } from "../../../lib/liquidity-utils";
import { AllowanceTransfer, permit2Address, PERMIT2_ADDRESS, PermitBatch } from '@uniswap/permit2-sdk';

// Note: POSITION_MANAGER_ADDRESS and STATE_VIEW_ADDRESS are now fetched dynamically per-request
// using getPositionManagerAddress(networkMode) and getStateViewAddress(networkMode)
const ETHERS_ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";
const SDK_MIN_TICK = -887272;
const SDK_MAX_TICK = 887272;

interface PrepareMintTxRequest extends NextApiRequest {
    body: {
        userAddress: string;
        token0Symbol: TokenSymbol;
        token1Symbol: TokenSymbol;
        inputAmount: string;
        inputTokenSymbol: TokenSymbol;
        userTickLower: number;
        userTickUpper: number;
        chainId: number;
        // User settings from frontend (optional - defaults provided)
        slippageBps?: number; // Slippage in basis points (e.g., 50 = 0.5%). Default: 50
        deadlineMinutes?: number; // Transaction deadline in minutes. Default: 20
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

// Updated ApprovalNeededResponse to handle streamlined batch permit flow
interface ApprovalNeededResponse {
    needsApproval: true;
    approvalType: 'ERC20_TO_PERMIT2' | 'PERMIT2_BATCH_SIGNATURE';

    // For ERC20_TO_PERMIT2 (token approval to Permit2)
    approvalTokenAddress?: string;
    approvalTokenSymbol?: TokenSymbol;
    approveToAddress?: string; // Will be PERMIT2_ADDRESS
    approvalAmount?: string; // Will be maxUint256.toString()

    // For PERMIT2_BATCH_SIGNATURE (batch permit signature)
    permitBatchData?: {
        domain?: never; // unified below
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
        // Legacy format support
        details?: Array<{
            token: string;
            amount: string;
            expiration: string;
            nonce: string;
        }>;
        spender?: string; // Position Manager address
        sigDeadline?: string;
    };
    signatureDetails?: {
        domain: {
            name: string;
            chainId: number;
            verifyingContract: Hex; // PERMIT2_ADDRESS
            version?: string;
        };
        types: typeof PERMIT2_TYPES; // The actual type definitions for EIP-712
        primaryType: 'PermitBatch';
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
    // Position details
    dependentAmount?: string;
    deadline: string;
    details: {
        token0: { address: string; symbol: TokenSymbol; amount: string; };
        token1: { address: string; symbol: TokenSymbol; amount: string; };
        liquidity: string;
        finalTickLower: number;
        finalTickUpper: number;
    };
}

type PrepareMintTxResponse = ApprovalNeededResponse | TransactionPreparedResponse | { message: string; error?: any };

export default async function handler(
    req: PrepareMintTxRequest,
    res: NextApiResponse<PrepareMintTxResponse>
) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
    }

    // Rate limiting
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
    const rateCheck = checkTxRateLimit(clientIp);
    if (!rateCheck.allowed) {
        res.setHeader('Retry-After', String(rateCheck.retryAfter || 60));
        return res.status(429).json({ message: 'Too many requests. Please try again later.' });
    }

    // Get network mode from cookies for proper chain-specific addresses
    const networkMode = getNetworkModeFromRequest(req.headers.cookie);

    // Create network-specific public client
    const publicClient = createNetworkClient(networkMode);

    // Get network-specific contract addresses
    const POSITION_MANAGER_ADDRESS = getPositionManagerAddress(networkMode);
    const STATE_VIEW_ADDRESS = getStateViewAddress(networkMode);

    const stateViewAbiViem = parseAbi(STATE_VIEW_HUMAN_READABLE_ABI);

    try {
        const {
            userAddress,
            token0Symbol,
            token1Symbol,
            inputAmount,
            inputTokenSymbol,
            userTickLower,
            userTickUpper,
            chainId,
            slippageBps = 50, // Default: 0.5%
            deadlineMinutes = 20, // Default: 20 minutes
        } = req.body;

        // Create slippage tolerance from user settings
        // slippageBps is in basis points (50 = 0.5%), so divide by 10000 to get percentage
        const SLIPPAGE_TOLERANCE = new Percent(slippageBps, 10_000);

        // ChainId validation - CRITICAL security check
        const chainIdError = validateChainId(chainId, networkMode);
        if (chainIdError) {
            return res.status(400).json({ message: chainIdError });
        }

        if (!isAddress(userAddress)) {
            return res.status(400).json({ message: "Invalid userAddress." });
        }

        const token0Config = getToken(token0Symbol, networkMode);
        const token1Config = getToken(token1Symbol, networkMode);
        const inputTokenConfig = getToken(inputTokenSymbol, networkMode);

        if (!token0Config || !token1Config || !inputTokenConfig) {
            return res.status(400).json({ message: "Invalid token symbol(s) provided." });
        }
        if (isNaN(parseFloat(inputAmount)) || parseFloat(inputAmount) <= 0) {
            return res.status(400).json({ message: "Invalid inputAmount." });
        }
        if (typeof userTickLower !== 'number' || typeof userTickUpper !== 'number') {
            return res.status(400).json({ message: "userTickLower and userTickUpper must be numbers." });
        }

        const sdkToken0 = new Token(chainId, getAddress(token0Config.address), token0Config.decimals, token0Config.symbol);
        const sdkToken1 = new Token(chainId, getAddress(token1Config.address), token1Config.decimals, token1Config.symbol);
        const sdkInputToken = inputTokenSymbol === token0Symbol ? sdkToken0 : sdkToken1;

        const normalizeAmountString = (raw: string): string => {
            let s = (raw ?? '').toString().trim().replace(/,/g, '.');
            if (!/e|E/.test(s)) return s;
            // Expand scientific notation without using floats
            const match = s.match(/^([+-]?)(\d*\.?\d+)[eE]([+-]?\d+)$/);
            if (!match) return s; // fallback
            const sign = match[1] || '';
            const num = match[2];
            const exp = parseInt(match[3], 10);
            const parts = num.split('.');
            const intPart = parts[0] || '0';
            const fracPart = parts[1] || '';
            const digits = (intPart + fracPart).replace(/^0+/, '') || '0';
            let pointIndex = intPart.length;
            let newPoint = pointIndex + exp;
            if (exp >= 0) {
                if (newPoint >= digits.length) {
                    const zeros = '0'.repeat(newPoint - digits.length);
                    return sign + digits + zeros;
                } else {
                    return sign + digits.slice(0, newPoint) + '.' + digits.slice(newPoint);
                }
            } else {
                if (newPoint <= 0) {
                    const zeros = '0'.repeat(-newPoint);
                    return sign + '0.' + zeros + digits;
                } else {
                    return sign + digits.slice(0, newPoint) + '.' + digits.slice(newPoint);
                }
            }
        };

        const normalizedInput = normalizeAmountString(inputAmount);
        const parsedInputAmount_BigInt = parseUnits(normalizedInput, sdkInputToken.decimals); 
        const parsedInputAmount_JSBI = JSBI.BigInt(parsedInputAmount_BigInt.toString()); 

        // Use configured pool ID from pools.json instead of deriving
        const { getPoolByTokens } = await import('../../../lib/pools-config');
        const poolConfig = getPoolByTokens(token0Symbol, token1Symbol, networkMode);
        
        if (!poolConfig) {
            return res.status(400).json({ message: `No pool configuration found for ${token0Symbol}/${token1Symbol}` });
        }

        const clampedUserTickLower = Math.max(userTickLower, SDK_MIN_TICK);
        const clampedUserTickUpper = Math.min(userTickUpper, SDK_MAX_TICK);
        let tickLower = nearestUsableTick(clampedUserTickLower, poolConfig.tickSpacing);
        let tickUpper = nearestUsableTick(clampedUserTickUpper, poolConfig.tickSpacing);
        if (tickLower >= tickUpper) {
            tickLower = tickUpper - poolConfig.tickSpacing;
        }

        // After alignment, the previous clamp adjusts ordering. No further error required here.
        
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
        
        // sortedToken0/1 determined above

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

            // Check if pool is initialized
            if (sqrtPriceX96Current === 0n) {
                return res.status(400).json({ 
                    message: `Pool ${token0Symbol}/${token1Symbol} (${poolId}) is not initialized. sqrtPriceX96 = 0. This is likely why you're getting PoolNotInitialized errors.` 
                });
            }

        } catch (error) {
            console.error("API Error (prepare-mint-tx) fetching pool slot0 data:", error);
            return res.status(500).json({ message: "Failed to fetch current pool data.", error });
        }

        // Use NativeCurrency for the native leg to satisfy SDK native handling
        const poolCurrency0 = sortedToken0.address === ETHERS_ADDRESS_ZERO ? Ether.onChain(Number(chainId)) : sortedToken0;
        const poolCurrency1 = sortedToken1.address === ETHERS_ADDRESS_ZERO ? Ether.onChain(Number(chainId)) : sortedToken1;

        const v4PoolForCalc = new V4Pool(
            poolCurrency0 as any,
            poolCurrency1 as any,
            poolConfig.fee, // Use fee from pool configuration 
            poolConfig.tickSpacing, // Use tick spacing from pool configuration
            poolConfig.hooks as `0x${string}`, // Use hook address from pool configuration
            currentSqrtPriceX96_JSBI, 
            JSBI.BigInt(currentLiquidity.toString()), 
            currentTick
        );

        // Extract permit data early to determine which amounts to use
        const { permitSignature: batchPermitSignature, permitBatchData } = req.body;
        const hasBatchPermit = batchPermitSignature && permitBatchData;

        // Build initial position from input amount
        let position: V4Position;
        if (sdkInputToken.address === sortedToken0.address) {
            position = V4Position.fromAmount0({
                pool: v4PoolForCalc,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0: parsedInputAmount_JSBI,
                useFullPrecision: true
            });
        } else {
            position = V4Position.fromAmount1({
                pool: v4PoolForCalc,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount1: parsedInputAmount_JSBI
            });
        }

        // NOTE: We do NOT rebuild the position from permit amounts.
        // The position is already correctly built from inputAmount above.
        // The permit is just for authorization - rebuilding from permit amounts
        // can introduce precision issues or incorrect amounts.
        // The permit batch values are extracted below only for use in mintOptions.
        const permitBatchValues = hasBatchPermit ? (permitBatchData.values || {
            details: permitBatchData.details || [],
            spender: permitBatchData.spender || POSITION_MANAGER_ADDRESS,
            sigDeadline: permitBatchData.sigDeadline || '0'
        }) : null;

        const liquidity = position.liquidity;
        let amount0 = BigInt(position.mintAmounts.amount0.toString());
        let amount1 = BigInt(position.mintAmounts.amount1.toString());

        // CRITICAL: Use slippage-adjusted amounts for permits (matches SDK's addCallParameters)
        // The SDK's permitBatchData() and addCallParameters() both use mintAmountsWithSlippage
        // SLIPPAGE_TOLERANCE is defined at top of handler from user's slippageBps setting
        const slippageAmountsForPermit = position.mintAmountsWithSlippage(SLIPPAGE_TOLERANCE);
        const amount0ForPermit = BigInt(slippageAmountsForPermit.amount0.toString());
        const amount1ForPermit = BigInt(slippageAmountsForPermit.amount1.toString());

        // SDK returns maxUint256 for amounts not needed in single-sided (OOR) positions - treat as 0
        const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
        if (amount0 >= MAX_UINT256 / 2n) amount0 = 0n;
        if (amount1 >= MAX_UINT256 / 2n) amount1 = 0n;

        const MAX_UINT_128 = (1n << 128n) - 1n;
        if (JSBI.GT(liquidity, JSBI.BigInt(MAX_UINT_128.toString()))) {
            return res.status(400).json({
                message: "The selected price range is too narrow for the provided input amount, resulting in an impractically large liquidity value."
            });
        }

        if (amount0 <= 0n && amount1 <= 0n && JSBI.GT(liquidity, JSBI.BigInt(0))) {
            return res.status(400).json({ message: "Calculation resulted in zero amounts for both tokens but positive liquidity. This is an unlikely scenario, please check inputs." });
        }
        if (amount0 <= 0n && amount1 <= 0n && JSBI.LE(liquidity, JSBI.BigInt(0))) {
            return res.status(400).json({ message: "Calculation resulted in zero amounts and zero liquidity. Please provide a valid input amount and range." });
        }

        // Use slippage-adjusted amounts for permit checks (matches what addCallParameters will transfer)
        const tokensToCheck = [
            { sdkToken: sortedToken0, requiredAmount: amount0, permitAmount: amount0ForPermit, symbol: getToken(sortedToken0.symbol as TokenSymbol, networkMode)?.symbol || sortedToken0.symbol || "Token0" },
            { sdkToken: sortedToken1, requiredAmount: amount1, permitAmount: amount1ForPermit, symbol: getToken(sortedToken1.symbol as TokenSymbol, networkMode)?.symbol || sortedToken1.symbol || "Token1" }
        ];

        const hasNativeETH = sortedToken0.address === ETHERS_ADDRESS_ZERO || sortedToken1.address === ETHERS_ADDRESS_ZERO;

        // Always check ERC20 allowances to Permit2 (required even with permit signature)
        for (const t of tokensToCheck) {
            if (getAddress(t.sdkToken.address) === ETHERS_ADDRESS_ZERO || t.requiredAmount <= 0n) continue;

            const erc20Allowance = await publicClient.readContract({
                address: getAddress(t.sdkToken.address) as `0x${string}`,
                abi: parseAbi(['function allowance(address,address) view returns (uint256)']),
                functionName: 'allowance',
                args: [getAddress(userAddress), PERMIT2_ADDRESS]
            });

            if (erc20Allowance < t.requiredAmount) {
                return res.status(200).json({
                    needsApproval: true,
                    approvalType: 'ERC20_TO_PERMIT2' as const,
                    approvalTokenAddress: t.sdkToken.address,
                    approvalTokenSymbol: t.symbol,
                    approveToAddress: PERMIT2_ADDRESS,
                    approvalAmount: maxUint256.toString(),
                });
            }
        }

        // Check Permit2 allowances ONLY if no permit signature is provided
        // (permit signature will be validated on-chain during transaction execution)
        if (!hasBatchPermit) {
            const latestBlockViem = await publicClient.getBlock({ blockTag: 'latest' });
            if (!latestBlockViem) throw new Error("Failed to get latest block for deadline.");

            const PERMIT_EXPIRATION_MS = PERMIT_EXPIRATION_DURATION_SECONDS * 1000;
            const PERMIT_SIG_EXPIRATION_MS = PERMIT_SIG_DEADLINE_DURATION_SECONDS * 1000;
            const currentTimestamp = Number(latestBlockViem.timestamp);
            const toDeadline = (expiration: number): number => currentTimestamp + Math.floor(expiration / 1000);

            const permitsNeeded: Array<{
                token: string;
                amount: string;
                expiration: string;
                nonce: string;
            }> = [];

            for (const t of tokensToCheck) {
                if (getAddress(t.sdkToken.address) === ETHERS_ADDRESS_ZERO || t.permitAmount <= 0n) continue;

                const [permitAmt, permitExp, permitNonce] = await publicClient.readContract({
                    address: PERMIT2_ADDRESS,
                    abi: iallowance_transfer_abi,
                    functionName: 'allowance',
                    args: [getAddress(userAddress), getAddress(t.sdkToken.address), POSITION_MANAGER_ADDRESS]
                }) as readonly [amount: bigint, expiration: number, nonce: number];

                // Check if existing permit covers slippage-adjusted amount
                const hasValidPermit = permitAmt >= t.permitAmount && permitExp > currentTimestamp;
                if (hasValidPermit) continue;

                // Use slippage-adjusted amount for permit (matches SDK's permitBatchData behavior)
                permitsNeeded.push({
                    token: getAddress(t.sdkToken.address),
                    amount: t.permitAmount.toString(),
                    expiration: toDeadline(PERMIT_EXPIRATION_MS).toString(),
                    nonce: permitNonce.toString(),
                });
            }

            if (permitsNeeded.length > 0) {
                    const permit = {
                        details: permitsNeeded,
                        spender: POSITION_MANAGER_ADDRESS,
                        sigDeadline: toDeadline(PERMIT_SIG_EXPIRATION_MS).toString(),
                    };

                    const permitData = AllowanceTransfer.getPermitData(permit, permit2Address(chainId), chainId);

                    if (!('details' in permitData.values) || !Array.isArray(permitData.values.details)) {
                        throw new Error('Expected PermitBatch data structure');
                    }

                    const { domain, types, values } = permitData as {
                        domain: typeof permitData.domain;
                        types: typeof permitData.types;
                        values: PermitBatch;
                    };

                    const permitBatchData = {
                        domain,
                        types,
                        valuesRaw: values,
                        values: {
                            details: values.details.map((detail: any) => ({
                                token: detail.token,
                                amount: detail.amount.toString(),
                                expiration: detail.expiration.toString(),
                                nonce: detail.nonce.toString(),
                            })),
                            spender: values.spender,
                            sigDeadline: values.sigDeadline.toString(),
                        },
                    } as any;

                    return res.status(200).json({
                        needsApproval: true,
                        approvalType: 'PERMIT2_BATCH_SIGNATURE' as const,
                        permitBatchData,
                        signatureDetails: {
                            domain: {
                                name: domain.name || 'Permit2',
                                chainId: Number(domain.chainId || chainId),
                                verifyingContract: (domain.verifyingContract || PERMIT2_ADDRESS) as `0x${string}`,
                            },
                            types: PERMIT2_TYPES,
                            primaryType: 'PermitBatch',
                        }
                    });
            }
        }

        // If all checks passed for both tokens, proceed to prepare the transaction using V4PositionManager
        // Calculate deadline for transaction using user's deadlineMinutes setting
        const latestBlockForTx = await publicClient.getBlock({ blockTag: 'latest' });
        if (!latestBlockForTx) throw new Error("Failed to get latest block for deadline.");
        const deadlineSeconds = BigInt(deadlineMinutes) * 60n;
        const deadlineBigInt = latestBlockForTx.timestamp + deadlineSeconds;

        // Create MintOptions for V4PositionManager
        // Uses same SLIPPAGE_TOLERANCE defined at top of handler from user's slippageBps
        let mintOptions: MintOptions = {
            slippageTolerance: SLIPPAGE_TOLERANCE, // From user settings (default: 0.5%)
            deadline: deadlineBigInt.toString(),
            recipient: getAddress(userAddress),
            hookData: '0x',
            // Always set when the pool involves the native token to satisfy SDK invariant
            useNative: hasNativeETH ? Ether.onChain(Number(chainId)) : undefined
        };

        if (permitBatchValues) {
            // Ensure permitBatchValues has correct structure for SDK
            // Use AllowanceTransferPermitBatch type from v4-sdk for compatibility with MintOptions
            // Note: BigintIsh expects JSBI | string | number, so we pass values as strings
            const permitBatchForSDK: AllowanceTransferPermitBatch = {
                details: permitBatchValues.details.map((detail: any) => ({
                    token: getAddress(detail.token),
                    amount: String(detail.amount),
                    expiration: String(detail.expiration),
                    nonce: String(detail.nonce),
                })),
                spender: getAddress(permitBatchValues.spender),
                sigDeadline: String(permitBatchValues.sigDeadline),
            };

            mintOptions = {
                ...mintOptions,
                batchPermit: {
                    owner: getAddress(userAddress),
                    permitBatch: permitBatchForSDK,
                    signature: batchPermitSignature as string,
                }
            };
        }

        const methodParameters = V4PositionManager.addCallParameters(position, mintOptions);
        const encodedModifyLiquiditiesCallDataViem = methodParameters.calldata;
        const transactionValue = methodParameters.value ?? "0";

        // Calculate dependent amount (the amount that was calculated from the input)
        const isInputToken0 = sdkInputToken.address === sortedToken0.address;
        const dependentAmount = isInputToken0 ? amount1.toString() : amount0.toString();

        // Response format aligned with Uniswap Trading API CreateLPPositionResponse
        return res.status(200).json({
            needsApproval: false,
            // Uniswap-style 'create' field
            create: {
                to: POSITION_MANAGER_ADDRESS,
                from: getAddress(userAddress),
                data: encodedModifyLiquiditiesCallDataViem,
                value: transactionValue,
                chainId: chainId,
            },
            // Backwards compatibility
            transaction: {
                to: POSITION_MANAGER_ADDRESS,
                data: encodedModifyLiquiditiesCallDataViem,
                value: transactionValue
            },
            // Pool state (matches Uniswap response)
            sqrtRatioX96: currentSqrtPriceX96_JSBI.toString(),
            currentTick: currentTick,
            poolLiquidity: currentLiquidity.toString(),
            // Dependent amount (the calculated amount for the other token)
            dependentAmount,
            deadline: deadlineBigInt.toString(),
            details: {
                token0: { address: sortedToken0.address, symbol: (getToken(sortedToken0.symbol as TokenSymbol, networkMode)?.symbol || sortedToken0.symbol) as TokenSymbol, amount: amount0.toString() },
                token1: { address: sortedToken1.address, symbol: (getToken(sortedToken1.symbol as TokenSymbol, networkMode)?.symbol || sortedToken1.symbol) as TokenSymbol, amount: amount1.toString() },
                liquidity: liquidity.toString(),
                finalTickLower: tickLower,
                finalTickUpper: tickUpper
            }
        });

    } catch (error: any) {
        console.error("[API prepare-mint-tx] Error:", error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
        const errorDetails = process.env.NODE_ENV === 'development' && error instanceof Error ? { name: error.name, stack: error.stack, cause: error.cause } : {};
        return res.status(500).json({ message: errorMessage, error: errorDetails });
    }
} 