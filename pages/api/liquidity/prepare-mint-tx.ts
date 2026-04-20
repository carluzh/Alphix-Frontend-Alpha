import { Token, Percent, Ether } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position, V4PositionManager } from "@uniswap/v4-sdk";
import type { MintOptions } from "@uniswap/v4-sdk";
import { nearestUsableTick, TickMath } from '@uniswap/v3-sdk';
import JSBI from 'jsbi';
import type { NextApiRequest, NextApiResponse } from 'next';

import { STATE_VIEW_ABI as STATE_VIEW_HUMAN_READABLE_ABI } from "@/lib/abis/state_view_abi";
import { TokenSymbol, getToken, getPositionManagerAddress, getStateViewAddress, getPoolBySlugMultiChain } from "@/lib/pools-config";
import { validateChainId, checkTxRateLimit } from "@/lib/tx-validation";
import { resolveNetworkMode } from "@/lib/network-mode";
import { createNetworkClient } from "@/lib/viemClient";
import {
    isAddress,
    getAddress,
    parseAbi,
    maxUint256,
    parseUnits,
    zeroAddress,
    type Hex
} from "viem";

import { PERMIT2_ADDRESS } from '@uniswap/permit2-sdk';
import { checkERC20Allowances, buildPermitBatchData, buildPermitBatchForSDK, type TokenForPermitCheck } from '@/lib/liquidity/transaction/permit2-checks';
import { isUnifiedYieldPool } from '@/lib/liquidity/utils/pool-type-guards';
import { uniswapLPAPI, UniswapLPAPIError } from '@/lib/liquidity/uniswap-api/client';

interface PrepareMintTxRequest extends NextApiRequest {
    body: {
        userAddress: string;
        poolId?: string;
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
    erc20ApprovalNeeded?: boolean;
    // Per-token approval flags
    needsToken0Approval?: boolean;
    needsToken1Approval?: boolean;

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
        // Using SDK's types directly for proper EIP-712 format
        // Previously used PERMIT2_TYPES which included PermitSingle and confused wallet decoders
        types: Record<string, Array<{ name: string; type: string }>>;
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
        gasLimit?: string; // Estimated gas limit with 20% buffer
    };
    // Backwards compatibility - same as 'create'
    transaction: {
        to: string;
        data: string;
        value: string;
        gasLimit?: string; // Estimated gas limit with 20% buffer
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

    const networkMode = resolveNetworkMode(req);

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

        // Use pool ID from request body (required for disambiguation when multiple pools share tokens)
        const requestPoolId = req.body.poolId;
        const { getPoolByTokens } = await import('@/lib/pools-config');
        const poolConfig = requestPoolId
            ? getPoolBySlugMultiChain(requestPoolId)
            : getPoolByTokens(token0Symbol, token1Symbol, networkMode);

        if (!poolConfig) {
            return res.status(400).json({ message: `No pool configuration found for ${requestPoolId || `${token0Symbol}/${token1Symbol}`}` });
        }

        const clampedUserTickLower = Math.max(userTickLower, TickMath.MIN_TICK);
        const clampedUserTickUpper = Math.min(userTickUpper, TickMath.MAX_TICK);
        let tickLower = nearestUsableTick(clampedUserTickLower, poolConfig.tickSpacing);
        let tickUpper = nearestUsableTick(clampedUserTickUpper, poolConfig.tickSpacing);
        if (tickLower >= tickUpper) {
            tickLower = tickUpper - poolConfig.tickSpacing;
        }

        // Route non-UY pools through Uniswap Liquidity API.
        if (!isUnifiedYieldPool(poolConfig)) {
            try {
                // 1. Check approvals against both pool tokens.
                const approvalCheck = await uniswapLPAPI.checkApproval({
                    walletAddress: getAddress(userAddress),
                    chainId,
                    protocol: 'V4',
                    lpTokens: [
                        { tokenAddress: getAddress(token0Config.address), amount: parsedInputAmount_BigInt.toString() },
                        { tokenAddress: getAddress(token1Config.address), amount: parsedInputAmount_BigInt.toString() },
                    ],
                    action: 'CREATE',
                });

                if (approvalCheck.transactions.length > 0) {
                    const next = approvalCheck.transactions[0];
                    const tokenAddr = getAddress(next.tokenAddress ?? next.transaction.to);
                    const isToken0 = tokenAddr.toLowerCase() === getAddress(token0Config.address).toLowerCase();
                    const needsToken0Approval = approvalCheck.transactions.some(t =>
                        getAddress(t.tokenAddress ?? t.transaction.to).toLowerCase() === getAddress(token0Config.address).toLowerCase());
                    const needsToken1Approval = approvalCheck.transactions.some(t =>
                        getAddress(t.tokenAddress ?? t.transaction.to).toLowerCase() === getAddress(token1Config.address).toLowerCase());
                    return res.status(200).json({
                        needsApproval: true,
                        approvalType: 'ERC20_TO_PERMIT2' as const,
                        approvalTokenAddress: tokenAddr,
                        approvalTokenSymbol: (isToken0 ? token0Symbol : token1Symbol) as TokenSymbol,
                        approveToAddress: next.transaction.to,
                        approvalAmount: maxUint256.toString(),
                        erc20ApprovalNeeded: true,
                        needsToken0Approval,
                        needsToken1Approval,
                    });
                }

                // 2. Build create tx.
                const inputTokenAddress = inputTokenSymbol === token0Symbol
                    ? getAddress(token0Config.address)
                    : getAddress(token1Config.address);

                const response = await uniswapLPAPI.create({
                    walletAddress: getAddress(userAddress),
                    chainId,
                    protocol: 'V4',
                    existingPool: {
                        token0Address: getAddress(token0Config.address),
                        token1Address: getAddress(token1Config.address),
                        poolReference: poolConfig.poolId,
                    },
                    independentToken: {
                        tokenAddress: inputTokenAddress,
                        amount: parsedInputAmount_BigInt.toString(),
                    },
                    tickBounds: { tickLower, tickUpper },
                    simulateTransaction: false,
                });

                // Fetch pool state for UI fields expected by response contract.
                const [slot0Result, liquidityResult] = await publicClient.multicall({
                    contracts: [
                        { address: STATE_VIEW_ADDRESS, abi: stateViewAbiViem, functionName: 'getSlot0', args: [poolConfig.poolId as Hex] },
                        { address: STATE_VIEW_ADDRESS, abi: stateViewAbiViem, functionName: 'getLiquidity', args: [poolConfig.poolId as Hex] },
                    ],
                    allowFailure: true,
                });
                const slot0 = slot0Result.status === 'success'
                    ? (slot0Result.result as readonly [bigint, number, number, number])
                    : ([0n, 0, 0, 0] as const);
                const curLiquidity = liquidityResult.status === 'success' ? (liquidityResult.result as bigint) : 0n;

                const latestBlockForTx = await publicClient.getBlock({ blockTag: 'latest' });
                const deadlineBigInt = latestBlockForTx.timestamp + BigInt(deadlineMinutes) * 60n;

                return res.status(200).json({
                    needsApproval: false,
                    create: {
                        to: response.create.to,
                        from: response.create.from,
                        data: response.create.data,
                        value: response.create.value,
                        chainId,
                    },
                    transaction: {
                        to: response.create.to,
                        data: response.create.data,
                        value: response.create.value,
                    },
                    sqrtRatioX96: slot0[0].toString(),
                    currentTick: slot0[1],
                    poolLiquidity: curLiquidity.toString(),
                    deadline: deadlineBigInt.toString(),
                    details: {
                        token0: { address: getAddress(token0Config.address), symbol: token0Symbol, amount: response.token0.amount },
                        token1: { address: getAddress(token1Config.address), symbol: token1Symbol, amount: response.token1.amount },
                        finalTickLower: response.tickLower,
                        finalTickUpper: response.tickUpper,
                        liquidity: '0',
                    },
                });
            } catch (e) {
                if (e instanceof UniswapLPAPIError) {
                    console.error('[prepare-mint-tx] Uniswap LP API error:', e.status, e.message);
                    return res.status(e.status >= 500 ? 502 : 400).json({ message: `Uniswap LP API: ${e.message}` });
                }
                throw e;
            }
        }

        // After alignment, the previous clamp adjusts ordering. No further error required here.
        
        const [sortedToken0, sortedToken1] = sdkToken0.sortsBefore(sdkToken1) 
            ? [sdkToken0, sdkToken1] 
            : [sdkToken1, sdkToken0];

        // Use the canonical on-chain poolId from config rather than recomputing via V4Pool.getPoolId().
        // Computing keccak256(PoolKey) requires all config values to be exact; any mismatch
        // (e.g. tickSpacing) produces a wrong hash and StateView reads return zeros.
        const poolId = poolConfig.poolId;
        
        // sortedToken0/1 determined above

        // Query current pool state

        let currentSqrtPriceX96_JSBI: JSBI;
        let currentTick: number;
        let currentLiquidity: bigint;

        try {
            // Batch pool state reads into single multicall
            const [slot0Result, liquidityResult] = await publicClient.multicall({
                contracts: [
                    {
                        address: STATE_VIEW_ADDRESS,
                        abi: stateViewAbiViem,
                        functionName: 'getSlot0',
                        args: [poolId as Hex]
                    },
                    {
                        address: STATE_VIEW_ADDRESS,
                        abi: stateViewAbiViem,
                        functionName: 'getLiquidity',
                        args: [poolId as Hex]
                    }
                ],
                allowFailure: true,
            });

            // Extract results - both required for pool state
            if (slot0Result.status !== 'success' || liquidityResult.status !== 'success') {
                const error = slot0Result.status === 'failure' ? slot0Result.error : liquidityResult.status === 'failure' ? liquidityResult.error : 'Unknown error';
                console.error("API Error (prepare-mint-tx) fetching pool slot0 data:", error);
                return res.status(500).json({ message: "Failed to fetch current pool data.", error: String(error) });
            }

            const slot0 = slot0Result.result as readonly [bigint, number, number, number];
            const liquidity = liquidityResult.result as bigint;
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

        // Detect native tokens early using getAddress for consistent comparison
        const isToken0Native = getAddress(sortedToken0.address) === zeroAddress;
        const isToken1Native = getAddress(sortedToken1.address) === zeroAddress;

        // Use NativeCurrency for the native leg to satisfy SDK native handling
        const poolCurrency0 = isToken0Native ? Ether.onChain(Number(chainId)) : sortedToken0;
        const poolCurrency1 = isToken1Native ? Ether.onChain(Number(chainId)) : sortedToken1;

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
        // Note: isToken0Native and isToken1Native were already computed earlier (before pool construction)
        const hasNativeETH = isToken0Native || isToken1Native;

        const token0Address = getAddress(sortedToken0.address);
        const tokensForCheck: [TokenForPermitCheck, TokenForPermitCheck] = [
            { address: isToken0Native ? zeroAddress : getAddress(sortedToken0.address), requiredAmount: amount0, permitAmount: amount0ForPermit, symbol: getToken(sortedToken0.symbol as TokenSymbol, networkMode)?.symbol || sortedToken0.symbol || "Token0", isNative: isToken0Native },
            { address: isToken1Native ? zeroAddress : getAddress(sortedToken1.address), requiredAmount: amount1, permitAmount: amount1ForPermit, symbol: getToken(sortedToken1.symbol as TokenSymbol, networkMode)?.symbol || sortedToken1.symbol || "Token1", isNative: isToken1Native },
        ];

        const { erc20ApprovalNeeded, needsToken0Approval, needsToken1Approval } =
            await checkERC20Allowances(publicClient, userAddress, tokensForCheck, token0Address);

        if (!hasBatchPermit) {
            const permitResult = await buildPermitBatchData(
                publicClient, userAddress, tokensForCheck, token0Address,
                POSITION_MANAGER_ADDRESS, chainId, needsToken0Approval, needsToken1Approval,
            );

            if (permitResult) {
                return res.status(200).json({
                    needsApproval: true,
                    approvalType: 'PERMIT2_BATCH_SIGNATURE' as const,
                    permitBatchData: permitResult.permitBatchData,
                    signatureDetails: permitResult.signatureDetails,
                    ...(erc20ApprovalNeeded && {
                        erc20ApprovalNeeded: true,
                        approvalTokenAddress: erc20ApprovalNeeded.address,
                        approvalTokenSymbol: erc20ApprovalNeeded.symbol,
                        approveToAddress: PERMIT2_ADDRESS,
                        approvalAmount: maxUint256.toString(),
                        needsToken0Approval,
                        needsToken1Approval,
                    }),
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
            const permitBatchForSDK = buildPermitBatchForSDK(permitBatchValues);

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

        // Only estimate gas when permit signature is provided (V4 uses SignatureTransfer)
        let gasLimit: string | undefined;
        if (hasBatchPermit) {
            try {
                const estimatedGas = await publicClient.estimateGas({
                    account: getAddress(userAddress),
                    to: POSITION_MANAGER_ADDRESS as `0x${string}`,
                    data: encodedModifyLiquiditiesCallDataViem as `0x${string}`,
                    value: transactionValue ? BigInt(transactionValue) : undefined,
                });
                gasLimit = ((estimatedGas * 120n) / 100n).toString();
            } catch (e) {
                console.warn('[prepare-mint-tx] Gas estimation failed, proceeding without:', e);
            }
        }

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
                gasLimit, // Include gas estimate
            },
            // Backwards compatibility
            transaction: {
                to: POSITION_MANAGER_ADDRESS,
                data: encodedModifyLiquiditiesCallDataViem,
                value: transactionValue,
                gasLimit, // Include gas estimate
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