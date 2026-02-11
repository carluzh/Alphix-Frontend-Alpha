import type { NextApiRequest, NextApiResponse } from 'next';
import { getAddress, encodeFunctionData, type Address, type Hex, type Abi, TransactionExecutionError } from 'viem';
import { validateChainId, validateAddress, checkTxRateLimit } from '../../../lib/tx-validation';
import { safeParseUnits } from '../../../lib/liquidity/utils/parsing/amountParsing';
import { Token } from '@uniswap/sdk-core';
import { RoutePlanner, CommandType } from '@uniswap/universal-router-sdk';
import { Pool, Route as V4Route, PoolKey, V4Planner, Actions, encodeRouteToPath } from '@uniswap/v4-sdk';
import { BigNumber } from 'ethers'; // For V4Planner compatibility if it expects Ethers BigNumber

import { createNetworkClient } from '../../../lib/viemClient';
import {
    TokenSymbol,
    getPoolConfigForTokens,
    createTokenSDK,
    createPoolKeyFromConfig,
    createCanonicalPoolKey,
    getNetworkModeFromRequest,
    getToken,
    NATIVE_TOKEN_ADDRESS,
} from '../../../lib/pools-config';
// State overrides for USDS simulation (Pool Manager has limited USDS balance)
import { getUsdsQuoteStateOverridesViem, needsUsdsStateOverride } from '../../../lib/swap/quote-state-override';
import { UniversalRouterAbi, TX_DEADLINE_SECONDS, PERMIT2_ADDRESS, Permit2Abi_allowance } from '@/lib/swap/swap-constants';
import { getUniversalRouterAddress, getStateViewAddress } from '../../../lib/pools-config';
import { findBestRoute, SwapRoute, routeToString } from '@/lib/swap/routing-engine';
import { STATE_VIEW_ABI } from '../../../lib/abis/state_view_abi';
import { ethers } from 'ethers';

// Define MaxUint160 here as well
const MaxUint160 = BigInt('0xffffffffffffffffffffffffffffffffffffffff');

// --- Helper: Convert human-readable price to sqrtPriceLimitX96 ---
function priceToSqrtPriceX96(price: number, token0: Token, token1: Token): bigint {
    // The price parameter is the human-readable price of token1 in terms of token0.
    // We need to convert this to a raw price ratio of token1's smallest units per token0's smallest units.
    // raw_price = human_price * (10^token1_decimals / 10^token0_decimals)
    const decimalAdjustedPrice = price * (10 ** (token1.decimals - token0.decimals));
    const sqrtPrice = Math.sqrt(decimalAdjustedPrice);
    const Q96 = BigInt(2) ** BigInt(96);
    return BigInt(Math.floor(sqrtPrice * Number(Q96)));
}

// --- Helper: Calculate price limit based on token ordering ---
function calculatePriceLimitX96(
    limitPrice: string,
    inputToken: Token,
    outputToken: Token,
    zeroForOne: boolean
): bigint {
    const numericLimitPrice = parseFloat(limitPrice);
    
    // Determine the canonical token0 and token1 for the pool
    const token0 = inputToken.sortsBefore(outputToken) ? inputToken : outputToken;
    const token1 = inputToken.sortsBefore(outputToken) ? outputToken : inputToken;

    let priceT1perT0: number;
    
    if (zeroForOne) {
        // Selling token0 for token1, price of token1/token0 increases.
        // The price limit is a MAXIMUM price (ceiling).
        // The user provides the limit in terms of token1 per token0, which is the pool's price format.
        priceT1perT0 = numericLimitPrice;
    } else {
        // Selling token1 for token0, price of token1/token0 decreases.
        // The price limit is a MINIMUM price (floor).
        // The user provides the limit in terms of token0 per token1, so we must invert it
        // for the pool's token1/token0 price format.
        // NOTE: This assumes the UI provides the price as token0/token1 for this case.
        priceT1perT0 = 1 / numericLimitPrice;
    }
    
    return priceToSqrtPriceX96(priceT1perT0, token0, token1);
}

// --- Helper: Determine swap direction ---
function determineSwapDirection(inputToken: Token, outputToken: Token): boolean {
    // Returns true if token0 -> token1 (zeroForOne = true)
    // Returns false if token1 -> token0 (zeroForOne = false)
    return inputToken.sortsBefore(outputToken);
}

// --- Guide-Exact Helper: encodeMultihopExactInPath ---
type PathKeyGuide = {
  intermediateCurrency: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
  hookData: string;
};

export function encodeMultihopExactInPath(
  poolKeys: PoolKey[],
  currencyIn: string
): PathKeyGuide[] {
  const pathKeys: PathKeyGuide[] = []
  let currentCurrencyIn = currencyIn
  
  for (let i = 0; i < poolKeys.length; i++) {
    // Determine the output currency for this hop
    const currencyOut = currentCurrencyIn === poolKeys[i].currency0
      ? poolKeys[i].currency1
      : poolKeys[i].currency0
    
    // Create path key for this hop
    const pathKey: PathKeyGuide = {
      intermediateCurrency: currencyOut,
      fee: poolKeys[i].fee,
      tickSpacing: poolKeys[i].tickSpacing,
      hooks: poolKeys[i].hooks,
      hookData: '0x'
    }
    
    pathKeys.push(pathKey)
    currentCurrencyIn = currencyOut // Output becomes input for next hop
  }
  
  return pathKeys
}

export function encodeMultihopExactOutPath(
  poolKeys: PoolKey[],
  currencyOut: string
): PathKeyGuide[] {
  const pathKeys: PathKeyGuide[] = []
  let currentCurrencyOut = currencyOut

  // For ExactOut, we process pools in reverse order to find intermediate currencies
  // But we build the path array in FORWARD order (same structure as ExactIn)
  for (let i = poolKeys.length - 1; i >= 0; i--) {
    // Determine the input currency for this hop (reverse direction)
    const currencyIn = currentCurrencyOut === poolKeys[i].currency0
      ? poolKeys[i].currency1
      : poolKeys[i].currency0

    // Create path key for this hop
    const pathKey: PathKeyGuide = {
      intermediateCurrency: currencyIn,
      fee: poolKeys[i].fee,
      tickSpacing: poolKeys[i].tickSpacing,
      hooks: poolKeys[i].hooks,
      hookData: '0x'
    }

    pathKeys.unshift(pathKey) // Add to FRONT to maintain forward order
    currentCurrencyOut = currencyIn // Input becomes output for next hop (going backwards)
  }

  return pathKeys
}


// =============================================================================
// V4 SWAP ACTION BUILDERS
// =============================================================================
//
// All V4 swap functions use the action order: SETTLE → SWAP → TAKE
//
// Why SETTLE first (instead of SWAP → SETTLE → TAKE)?
// - The USDS/USDC pool uses rehypothecated liquidity (USDS deposited in Sky vault)
// - Pool Manager only holds ~375 USDS on-chain
// - With SWAP first, the hook can't access enough USDS during beforeSwap
// - With SETTLE first, user's tokens are in Pool Manager BEFORE the swap executes
// - This allows hooks to access the settled tokens during the swap
//
// For ExactOut: We add a 4th action (TAKE_ALL input remainder) because:
// - We settle maxAmountIn (worst case with slippage)
// - The swap only uses actualAmountIn
// - V4 requires ALL deltas cleared at transaction end
// - The 4th TAKE_ALL returns unused input tokens to the user
// =============================================================================

interface V4PlanBuild {
    encodedActions: Hex;
    actions: any;
    params: any;
}

async function prepareV4ExactInSwapData(
    inputToken: Token,
    outputToken: Token,
    amountInSmallestUnits: bigint,
    minAmountOutSmallestUnits: bigint,
    poolConfig: any
): Promise<V4PlanBuild> {
    const v4PoolKey: PoolKey = createPoolKeyFromConfig(poolConfig.pool);

    const v4Planner = new V4Planner();

    const sqrtPriceLimitX96 = 0n;

    // Uniswap SDK ref: Use canonical token ordering to determine swap direction
    // zeroForOne = true when swapping from lower address (currency0) to higher address (currency1)
    const zeroForOne = inputToken.sortsBefore(outputToken);
    const inputCurrency = zeroForOne ? v4PoolKey.currency0 : v4PoolKey.currency1;
    const outputCurrency = zeroForOne ? v4PoolKey.currency1 : v4PoolKey.currency0;

    // See module-level comment for action ordering rationale (SETTLE → SWAP → TAKE)
    v4Planner.addAction(Actions.SETTLE, [
        inputCurrency,
        BigNumber.from(amountInSmallestUnits.toString()),
        true // payerIsUser = true
    ]);

    v4Planner.addAction(Actions.SWAP_EXACT_IN_SINGLE, [
        {
            poolKey: v4PoolKey,
            zeroForOne,
            amountIn: BigNumber.from(amountInSmallestUnits.toString()),
            amountOutMinimum: BigNumber.from(minAmountOutSmallestUnits.toString()),
            sqrtPriceLimitX96: BigNumber.from(sqrtPriceLimitX96.toString()),
            hookData: '0x'
        }
    ]);

    const isNativeOutput = outputToken.isNative;
    const takeAllMin = isNativeOutput ? 1n : minAmountOutSmallestUnits;
    v4Planner.addAction(Actions.TAKE_ALL, [outputCurrency, BigNumber.from(takeAllMin.toString())]);

    const encodedActions = v4Planner.finalize() as Hex;
    return { encodedActions, actions: (v4Planner as any).actions, params: (v4Planner as any).params };
}

// --- Helper: Prepare V4 Exact Output Swap Data (Adapted) ---
async function prepareV4ExactOutSwapData(
    inputToken: Token,
    outputToken: Token,
    maxAmountInSmallestUnits: bigint,
    amountOutSmallestUnits: bigint,
    poolConfig: any,
    limitPrice?: string,
    permitAmount?: bigint // The actual permitted amount (may differ slightly from maxAmountIn)
): Promise<V4PlanBuild> {
    const v4PoolKey: PoolKey = createPoolKeyFromConfig(poolConfig.pool);

    const v4Planner = new V4Planner();

    // Uniswap SDK ref: Use canonical token ordering to determine swap direction
    const zeroForOne = inputToken.sortsBefore(outputToken);
    const inputCurrency = zeroForOne ? v4PoolKey.currency0 : v4PoolKey.currency1;
    const outputCurrency = zeroForOne ? v4PoolKey.currency1 : v4PoolKey.currency0;

    // Calculate price limit if provided
    let sqrtPriceLimitX96 = 0n;
    if (limitPrice && limitPrice !== "" && parseFloat(limitPrice) > 0) {
        sqrtPriceLimitX96 = calculatePriceLimitX96(limitPrice, inputToken, outputToken, zeroForOne);
    }

    // See module-level comment for action ordering rationale (SETTLE → SWAP → TAKE → TAKE)
    // Use permitAmount for SETTLE (matches what user authorized via Permit2)
    const settleAmount = permitAmount ?? maxAmountInSmallestUnits;

    v4Planner.addAction(Actions.SETTLE, [
        inputCurrency,
        BigNumber.from(settleAmount.toString()),
        true // payerIsUser = true
    ]);

    v4Planner.addAction(Actions.SWAP_EXACT_OUT_SINGLE, [
        {
            poolKey: v4PoolKey,
            zeroForOne,
            amountOut: BigNumber.from(amountOutSmallestUnits.toString()),
            amountInMaximum: BigNumber.from(maxAmountInSmallestUnits.toString()),
            sqrtPriceLimitX96: BigNumber.from(sqrtPriceLimitX96.toString()),
            hookData: '0x'
        }
    ]);

    v4Planner.addAction(Actions.TAKE_ALL, [outputCurrency, BigNumber.from(amountOutSmallestUnits.toString())]);
    v4Planner.addAction(Actions.TAKE_ALL, [inputCurrency, BigNumber.from(0)]); // Return unused input

    const encodedActions = v4Planner.finalize() as Hex;
    return { encodedActions, actions: (v4Planner as any).actions, params: (v4Planner as any).params };
}

// --- Helper: Prepare V4 Multi-Hop Exact Input Swap Data ---
async function prepareV4MultiHopExactInSwapData(
    route: SwapRoute,
    amountInSmallestUnits: bigint,
    minAmountOutSmallestUnits: bigint,
    chainId: number,
    networkMode: 'mainnet' | 'testnet'
): Promise<V4PlanBuild> {
    const inputToken = createTokenSDK(route.path[0] as TokenSymbol, chainId, networkMode);
    const outputToken = createTokenSDK(route.path[route.path.length - 1] as TokenSymbol, chainId, networkMode);
    if (!inputToken || !outputToken) {
        throw new Error(`Failed to create token instances for multi-hop route`);
    }

    // Build PoolKeys for each hop from config
    const poolKeys: PoolKey[] = [];
    for (let i = 0; i < route.pools.length; i++) {
        const hop = route.pools[i];
        const poolCfg = getPoolConfigForTokens(hop.token0, hop.token1, networkMode);
        if (!poolCfg) throw new Error(`Pool config not found for hop ${i}: ${hop.poolName}`);
        const poolKey = createPoolKeyFromConfig(poolCfg.pool);
        poolKeys.push(poolKey);
    }
    const pathKeys = encodeMultihopExactInPath(poolKeys, inputToken.address);

    const v4Planner = new V4Planner();

    // Determine output currency
    const lastPoolKey = poolKeys[poolKeys.length - 1];
    const finalOutputToken = createTokenSDK(route.path[route.path.length - 1] as TokenSymbol, chainId, networkMode);
    if (!finalOutputToken) {
        throw new Error('Failed to create output token for TAKE_ALL');
    }
    const outputCurrency = getAddress(finalOutputToken.address!) === lastPoolKey.currency0
        ? lastPoolKey.currency0
        : lastPoolKey.currency1;

    // See module-level comment for action ordering rationale (SETTLE → SWAP → TAKE)
    v4Planner.addAction(Actions.SETTLE, [
        inputToken.address,
        BigNumber.from(amountInSmallestUnits.toString()),
        true // payerIsUser = true
    ]);

    v4Planner.addAction(Actions.SWAP_EXACT_IN, [
        {
            currencyIn: inputToken.address,
            path: pathKeys,
            amountIn: BigNumber.from(amountInSmallestUnits.toString()),
            amountOutMinimum: BigNumber.from(minAmountOutSmallestUnits.toString()),
        }
    ]);

    const isNativeOutput = outputToken.isNative;
    const takeAllMin = isNativeOutput ? 1n : minAmountOutSmallestUnits;
    v4Planner.addAction(Actions.TAKE_ALL, [outputCurrency, BigNumber.from(takeAllMin.toString())]);

    const encodedActions = v4Planner.finalize() as Hex;
    return { encodedActions, actions: (v4Planner as any).actions, params: (v4Planner as any).params };
}

// --- Helper: Prepare V4 Multi-Hop Exact Output Swap Data ---
async function prepareV4MultiHopExactOutSwapData(
    route: SwapRoute,
    maxAmountInSmallestUnits: bigint,
    amountOutSmallestUnits: bigint,
    chainId: number,
    networkMode: 'mainnet' | 'testnet',
    permitAmount?: bigint // The actual permitted amount (may differ slightly from maxAmountIn)
): Promise<V4PlanBuild> {
    const inputToken = createTokenSDK(route.path[0] as TokenSymbol, chainId, networkMode);
    const outputToken = createTokenSDK(route.path[route.path.length - 1] as TokenSymbol, chainId, networkMode);

    if (!inputToken || !outputToken) {
        throw new Error(`Failed to create token instances for multi-hop route`);
    }

    const poolKeys: PoolKey[] = [];
    for (let i = 0; i < route.pools.length; i++) {
        const hop = route.pools[i];
        const poolCfg = getPoolConfigForTokens(hop.token0, hop.token1, networkMode);
        if (!poolCfg) {
            throw new Error(`Missing pool config for hop ${i}: ${hop.poolName}`);
        }
        const poolKey = createPoolKeyFromConfig(poolCfg.pool);
        poolKeys.push(poolKey);
    }

    const pathKeys = encodeMultihopExactOutPath(poolKeys, outputToken.address);

    const v4Planner = new V4Planner();

    // See module-level comment for action ordering rationale (SETTLE → SWAP → TAKE → TAKE)
    // Use permitAmount for SETTLE (matches what user authorized via Permit2)
    const settleAmount = permitAmount ?? maxAmountInSmallestUnits;

    v4Planner.addAction(Actions.SETTLE, [
        inputToken.address,
        BigNumber.from(settleAmount.toString()),
        true // payerIsUser = true
    ]);

    v4Planner.addAction(Actions.SWAP_EXACT_OUT, [
        {
            currencyOut: outputToken.address,
            path: pathKeys,
            amountOut: BigNumber.from(amountOutSmallestUnits.toString()),
            amountInMaximum: BigNumber.from(maxAmountInSmallestUnits.toString()),
        }
    ]);

    const isNativeOutput = outputToken.isNative;
    const takeAllMin = isNativeOutput ? 1n : amountOutSmallestUnits;
    v4Planner.addAction(Actions.TAKE_ALL, [outputToken.address, BigNumber.from(takeAllMin.toString())]);
    v4Planner.addAction(Actions.TAKE_ALL, [inputToken.address, BigNumber.from(0)]); // Return unused input

    const encodedActions = v4Planner.finalize() as Hex;
    return { encodedActions, actions: (v4Planner as any).actions, params: (v4Planner as any).params };
}

interface BuildSwapTxRequest extends NextApiRequest {
    body: {
        userAddress: string;
        fromTokenSymbol: TokenSymbol;
        toTokenSymbol: TokenSymbol;
        swapType: 'ExactIn' | 'ExactOut';
        amountDecimalsStr: string;      // Amount to swap (input for ExactIn, output for ExactOut)
        limitAmountDecimalsStr: string; // Min output for ExactIn, Max input for ExactOut
        limitPrice?: string;            // Optional: V4 price limit for partial fills
        
        permitSignature: Hex;
        permitTokenAddress: string; // Address of the token that was permitted (INPUT_TOKEN)
        permitAmount: string;       // Amount (smallest units, string) that was permitted
        permitNonce: number;
        permitExpiration: number;   // Timestamp (seconds)
        permitSigDeadline: string;  // Timestamp (seconds, string for bigint)
        
        chainId: number;
    };
}

// Helper function to convert BigInts to strings recursively for JSON serialization
function jsonifyError(error: any): any {
    if (error === null || typeof error !== 'object') {
        return error;
    }

    if (error instanceof Error) {
        // Capture basic error properties and recursively process the cause if it exists
        const errorJson: Record<string, any> = {
            name: error.name,
            message: error.message,
            stack: error.stack, // Optional: include stack trace
        };
        if ('cause' in error) {
            errorJson.cause = jsonifyError((error as any).cause);
        }
         // Include shortMessage if it exists (common in Viem errors)
        if ('shortMessage' in error) {
           errorJson.shortMessage = (error as any).shortMessage;
        }
        // Include metaMessages if it exists (common in Viem errors)
        if ('metaMessages' in error) {
            errorJson.metaMessages = (error as any).metaMessages;
        }
        return errorJson;
    }
    
    if (Array.isArray(error)) {
        return error.map(jsonifyError);
    }

    const result: Record<string, any> = {};
    for (const key in error) {
        if (Object.prototype.hasOwnProperty.call(error, key)) {
            const value = error[key];
            if (typeof value === 'bigint') {
                result[key] = value.toString();
            } else if (typeof value === 'object') {
                result[key] = jsonifyError(value);
            } else {
                result[key] = value;
            }
        }
    }
    return result;
}

export default async function handler(req: BuildSwapTxRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ ok: false, message: `Method ${req.method} Not Allowed` });
    }

    // Rate limiting
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
    const rateCheck = checkTxRateLimit(clientIp);
    if (!rateCheck.allowed) {
        res.setHeader('Retry-After', String(rateCheck.retryAfter || 60));
        return res.status(429).json({ ok: false, message: 'Too many requests. Please try again later.' });
    }

    try {
        const {
            userAddress,
            fromTokenSymbol,
            toTokenSymbol,
            swapType,
            amountDecimalsStr,
            limitAmountDecimalsStr,
            limitPrice,
            permitSignature,
            permitTokenAddress,
            permitAmount,
            permitNonce,
            permitExpiration,
            permitSigDeadline,
            chainId
        } = req.body;

        // Get network mode from cookies for proper chain-specific addresses
        const networkMode = getNetworkModeFromRequest(req.headers.cookie);

        // ChainId validation - CRITICAL security check
        const chainIdError = validateChainId(chainId, networkMode);
        if (chainIdError) {
            return res.status(400).json({ ok: false, message: chainIdError });
        }

        // Address validation
        const userAddrError = validateAddress(userAddress, 'userAddress');
        if (userAddrError) {
            return res.status(400).json({ ok: false, message: userAddrError });
        }
        // Security: Check by address (0x0000...), not symbol - prevents spoofed ERC20 tokens named "ETH"
        const fromTokenConfig = getToken(fromTokenSymbol, networkMode);
        const isNativeInput = fromTokenConfig?.address === NATIVE_TOKEN_ADDRESS;
        const permitAddrError = !isNativeInput ? validateAddress(permitTokenAddress, 'permitTokenAddress') : null;
        if (permitAddrError) {
            return res.status(400).json({ ok: false, message: permitAddrError });
        }

        // Create network-specific public client
        const publicClient = createNetworkClient(networkMode);

        // Validate required fields (basic check)
        const requiredFields = [userAddress, fromTokenSymbol, toTokenSymbol, swapType, amountDecimalsStr, limitAmountDecimalsStr, permitSignature, permitTokenAddress, permitAmount, permitNonce, permitExpiration, permitSigDeadline, chainId];
        if (requiredFields.some(field => field === undefined || field === null)) {
            return res.status(400).json({ ok: false, message: 'Missing one or more required fields in request body.' });
        }
        if (fromTokenSymbol === toTokenSymbol) {
            return res.status(400).json({ ok: false, message: 'From and To tokens cannot be the same.' });
        }

        // Find the best route using the routing engine
        const routeResult = findBestRoute(fromTokenSymbol, toTokenSymbol, networkMode);
        
        if (!routeResult.bestRoute) {
            return res.status(400).json({ 
                ok: false,
                message: `No route found for token pair: ${fromTokenSymbol} → ${toTokenSymbol}`,
                error: 'No available pools to complete this swap'
            });
        }

        const route = routeResult.bestRoute;

        // For single-hop, we still need the pool config for backward compatibility
        let poolConfig: any = null;
        if (route.isDirectRoute) {
            poolConfig = getPoolConfigForTokens(fromTokenSymbol, toTokenSymbol, networkMode);
            if (!poolConfig) {
                return res.status(400).json({ ok: false, message: `Pool configuration not found for direct route: ${fromTokenSymbol} → ${toTokenSymbol}` });
            }
        }

        const INPUT_TOKEN = createTokenSDK(fromTokenSymbol, chainId, networkMode);
        const OUTPUT_TOKEN = createTokenSDK(toTokenSymbol, chainId, networkMode);

        if (!INPUT_TOKEN || !OUTPUT_TOKEN) {
            return res.status(400).json({ ok: false, message: 'Failed to create token instances.' });
        }
        
        const parsedPermitAmount = BigInt(permitAmount);
        const parsedPermitSigDeadline = BigInt(permitSigDeadline);

        let amountInSmallestUnits: bigint;
        let amountOutSmallestUnits: bigint; // Used for ExactOut amount, or for minAmountOut in ExactIn
        let v4Plan: V4PlanBuild;

        const routePlanner = new RoutePlanner();

        // 1. Add PERMIT2_PERMIT command *only if* a valid signature is provided and it's not a native ETH swap
        // Security: Use isNativeInput (address-based) instead of symbol check
        if (!isNativeInput && permitSignature !== "0x") {
            // S9: Re-validate nonce before building tx to prevent TOCTOU vulnerability
            // @see interface/apps/web/src/hooks/useUniswapXSwapCallback.ts:65-87
            const currentAllowance = await publicClient.readContract({
                address: PERMIT2_ADDRESS,
                abi: Permit2Abi_allowance,
                functionName: 'allowance',
                args: [getAddress(userAddress), getAddress(permitTokenAddress), getUniversalRouterAddress(networkMode)],
            }) as [bigint, number, number];
            const currentNonce = currentAllowance[2];

            if (currentNonce !== permitNonce) {
                return res.status(409).json({
                    ok: false,
                    message: 'Permit nonce changed. Please refresh and try again.',
                    error: 'NONCE_STALE',
                    details: { expectedNonce: permitNonce, currentNonce }
                });
            }

            // When submitting the permit command with a real signature,
            // the amount MUST match what was signed.
            routePlanner.addCommand(CommandType.PERMIT2_PERMIT, [
                [
                    [
                        getAddress(permitTokenAddress), // token
                        parsedPermitAmount,             // Use the actual signed amount
                        permitExpiration,               // expiration (number)
                        permitNonce                     // nonce (number)
                    ],
                    getUniversalRouterAddress(networkMode),        // spender
                    parsedPermitSigDeadline             // sigDeadline (bigint)
                ],
                permitSignature // The actual signature
            ]);
        }

        // 2. Prepare V4 Swap Data and add V4_SWAP command
        // Parse amounts according to swap type
        let actualSwapAmount: bigint; // ExactIn: amountIn; ExactOut: amountOut
        let actualLimitAmount: bigint; // ExactIn: minOut; ExactOut: maxIn
        if (swapType === 'ExactIn') {
            actualSwapAmount = safeParseUnits(amountDecimalsStr, INPUT_TOKEN.decimals);
            actualLimitAmount = safeParseUnits(limitAmountDecimalsStr, OUTPUT_TOKEN.decimals);
        } else {
            // ExactOut: amount is in OUTPUT token units; limit is max INPUT
            actualSwapAmount = safeParseUnits(amountDecimalsStr, OUTPUT_TOKEN.decimals);
            actualLimitAmount = safeParseUnits(limitAmountDecimalsStr, INPUT_TOKEN.decimals);
        }

        // Fail fast: reject if swap amount parsed to 0 but input wasn't explicitly zero
        // This preserves old behavior where invalid inputs threw errors
        const isExplicitZero = !amountDecimalsStr || amountDecimalsStr === '0' || amountDecimalsStr === '0.0';
        if (actualSwapAmount === 0n && !isExplicitZero) {
            return res.status(400).json({ ok: false, message: 'Invalid swap amount format' });
        }

        // Determine the value to send with the transaction (ETH input only)
        // Security: Use isNativeInput (address-based) instead of symbol check
        const txValue = isNativeInput
          ? (swapType === 'ExactIn' ? actualSwapAmount : actualLimitAmount)
          : 0n;

        if (swapType === 'ExactIn') {
            amountInSmallestUnits = actualSwapAmount; // Use the actual amount for the swap
            const minAmountOutSmallestUnits = actualLimitAmount;
            
            if (route.isDirectRoute) {
                // Single-hop swap using existing logic
                v4Plan = await prepareV4ExactInSwapData(
                    INPUT_TOKEN,
                    OUTPUT_TOKEN,
                    amountInSmallestUnits,
                    minAmountOutSmallestUnits,
                    poolConfig
                );
            } else {
                // Multi-hop swap using new logic
                v4Plan = await prepareV4MultiHopExactInSwapData(
                    route,
                    amountInSmallestUnits,
                    minAmountOutSmallestUnits,
                    chainId,
                    networkMode
                );
            }
        } else { // ExactOut
            amountOutSmallestUnits = actualSwapAmount; // amountOut in OUTPUT token units
            const maxAmountInSmallestUnits = actualLimitAmount; // max INPUT limit

            if (route.isDirectRoute) {
                // Single-hop swap using existing logic
                // Pass parsedPermitAmount to use as SETTLE amount (what user actually authorized)
                v4Plan = await prepareV4ExactOutSwapData(
                    INPUT_TOKEN,
                    OUTPUT_TOKEN,
                    maxAmountInSmallestUnits, // Max Input is the limit amount
                    amountOutSmallestUnits, // Actual output amount
                    poolConfig,
                    limitPrice,
                    parsedPermitAmount // Use permitted amount for SETTLE to avoid InsufficientAllowance
                );
            } else {
                // Multi-hop swap using new logic
                v4Plan = await prepareV4MultiHopExactOutSwapData(
                    route,
                    maxAmountInSmallestUnits,
                    amountOutSmallestUnits,
                    chainId,
                    networkMode,
                    parsedPermitAmount // Use permitted amount for SETTLE to avoid InsufficientAllowance
                );
            }
        }
        const encodedActions = v4Plan.encodedActions;
        routePlanner.addCommand(CommandType.V4_SWAP, [encodedActions]);

        // 3. Calculate Transaction Deadline
        const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));
        const txDeadline = currentTimestamp + BigInt(TX_DEADLINE_SECONDS);

        // 4. Simulate Transaction
        // Action order is now SETTLE → SWAP → TAKE, which ensures tokens are in Pool Manager
        // before the swap executes, allowing hooks to access them during the swap.
        //
        // For USDS swaps: Pool Manager only has ~375 USDS on-chain (rest is rehypothecated).
        // We use state overrides to give Pool Manager a virtual 10k USDS balance during simulation
        // so the eth_call doesn't fail. The actual on-chain swap will work because SETTLE first
        // brings tokens into Pool Manager before the swap executes.
        //
        // USDS ExactOut: Skip simulation entirely. The rehypothecated liquidity hook has complex
        // interactions with the Sky vault that can't be fully replicated via state overrides.
        // The quote was already verified, and on-chain execution works with SETTLE first.
        const isUsdsInput = needsUsdsStateOverride(INPUT_TOKEN.address);
        const isUsdsExactOut = isUsdsInput && swapType === 'ExactOut';

        if (!isUsdsExactOut) {
            const stateOverride = isUsdsInput ? getUsdsQuoteStateOverridesViem() : undefined;

            await publicClient.simulateContract({
                account: getAddress(userAddress),
                address: getUniversalRouterAddress(networkMode),
                abi: UniversalRouterAbi,
                functionName: 'execute',
                args: [routePlanner.commands as Hex, routePlanner.inputs as Hex[], txDeadline],
                value: txValue,
                stateOverride,
            });
        }
        // For USDS ExactOut: simulation skipped, quote already verified by quoter

        // Derive touched pools (friendly poolId and subgraphId) for downstream cache invalidation
        const touchedPools: Array<{ poolId: string; subgraphId?: string }> = [];
        try {
            if (route.isDirectRoute) {
                const poolCfg = getPoolConfigForTokens(fromTokenSymbol, toTokenSymbol, networkMode);
                if (poolCfg) {
                    touchedPools.push({ poolId: poolCfg.pool.id, subgraphId: poolCfg.pool.subgraphId || poolCfg.pool.id });
                }
            } else {
                for (const hop of route.pools) {
                    const cfg = getPoolConfigForTokens(hop.token0 as TokenSymbol, hop.token1 as TokenSymbol, networkMode);
                    if (cfg) touchedPools.push({ poolId: cfg.pool.id, subgraphId: cfg.pool.subgraphId || cfg.pool.id });
                }
            }
        } catch {}

        // Transaction building is real-time - never cache (Uniswap pattern)
        res.setHeader('Cache-Control', 'no-store');

        res.status(200).json({
            ok: true,
            commands: routePlanner.commands as Hex,
            inputs: routePlanner.inputs as Hex[],
            deadline: txDeadline.toString(),
            to: getUniversalRouterAddress(networkMode),
            value: txValue.toString(),
            route: {
                path: route.path,
                hops: route.hops,
                isDirectRoute: route.isDirectRoute,
                pools: route.pools.map(pool => pool.poolName)
            },
            limitPrice: limitPrice || null,
            touchedPools
        });

    } catch (error: any) {
        console.error("Error in /api/swap/build-tx:", error);

        let errorMessage = "Failed to build transaction.";

        if (error?.message) {
            const errorStr = error.message.toLowerCase();
            const swapType = req.body?.swapType;

            // Check for smart contract call exceptions
            if (errorStr.includes('call_exception') ||
                errorStr.includes('call revert exception') ||
                errorStr.includes('0x6190b2b0') || errorStr.includes('0x486aa307')) {
                errorMessage = swapType === 'ExactOut'
                    ? 'Amount exceeds available liquidity'
                    : 'Not enough liquidity';
            }
            // Check for liquidity depth errors
            else if (errorStr.includes('insufficient liquidity') ||
                     errorStr.includes('not enough liquidity') ||
                     errorStr.includes('pool has no liquidity')) {
                errorMessage = 'Not enough liquidity';
            }
            // Check for slippage-related errors
            else if (errorStr.includes('price impact too high') ||
                     errorStr.includes('slippage') ||
                     errorStr.includes('price moved too much')) {
                errorMessage = 'Price impact too high';
            }
            // Nonce errors (S9)
            else if (errorStr.includes('nonce') || errorStr.includes('invalid signature')) {
                errorMessage = 'Permit signature invalid or expired. Please try again.';
            }
            // Generic revert
            else if (errorStr.includes('revert') || errorStr.includes('execution reverted')) {
                errorMessage = swapType === 'ExactOut'
                    ? 'Cannot fulfill exact output amount'
                    : 'Transaction would revert';
            }
            // Balance errors
            else if (errorStr.includes('exceeds balance') ||
                     errorStr.includes('insufficient balance') ||
                     errorStr.includes('amount too large')) {
                errorMessage = 'Amount exceeds available liquidity';
            }
            // Keep specific error for viem TransactionExecutionError
            else if (error instanceof TransactionExecutionError) {
                errorMessage = error.shortMessage || error.message || errorMessage;
            }
        } else if (error instanceof TransactionExecutionError) {
            errorMessage = error.shortMessage || error.message || errorMessage;
        } else if (error instanceof Error) {
            errorMessage = error.message || errorMessage;
        }

        // Use the helper function to serialize the error safely
        const safeErrorJson = jsonifyError(error);

        res.status(500).json({
            ok: false,
            message: errorMessage,
            // Include errorDetails only in development
            ...(process.env.NODE_ENV !== 'production' && { errorDetails: safeErrorJson })
        });
    }
} 