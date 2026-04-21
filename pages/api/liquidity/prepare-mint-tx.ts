/**
 * prepare-mint-tx.ts — route non-UY V4 mint/create through Uniswap's LP API.
 *
 * Approvals come from /lp/check_approval; the final create tx from /lp/create.
 * UY deposits use a separate ERC-4626 flow; this route rejects them.
 * When v4BatchPermitData is present, returns PERMIT2_BATCH_SIGNATURE alongside
 * any ERC-20 approval fields so the frontend builds approval+sig+create steps.
 */

import { nearestUsableTick, TickMath } from '@uniswap/v3-sdk';
import * as Sentry from '@sentry/nextjs';
import type { NextApiRequest, NextApiResponse } from 'next';
import { isAddress, getAddress, maxUint256, parseUnits, parseAbi, type Hex } from 'viem';

import { STATE_VIEW_ABI as STATE_VIEW_HUMAN_READABLE_ABI } from '@/lib/abis/state_view_abi';
import {
  type TokenSymbol,
  getToken,
  getStateViewAddress,
  getPoolBySlugMultiChain,
  getPoolByTokens,
} from '@/lib/pools-config';
import { validateChainId, checkTxRateLimit } from '@/lib/tx-validation';
import { resolveNetworkMode } from '@/lib/network-mode';
import { createNetworkClient } from '@/lib/viemClient';
import { isUnifiedYieldPool } from '@/lib/liquidity/utils/pool-type-guards';
import { uniswapLPAPI, UniswapLPAPIError, UniswapLPAPIRateLimitError, normalizeV4BatchPermit, denormalizeV4BatchPermit } from '@/lib/liquidity/uniswap-api/client';

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
    slippageBps?: number;
    deadlineMinutes?: number;
    /** EIP-712 signature over the v4BatchPermitData typed data. */
    permitSignature?: string;
    /** Normalized batch permit data (echoed from prepare-mint-tx's first response). Denormalized before forwarding to /lp/create. */
    permitBatchData?: import('@/lib/liquidity/uniswap-api/client').V4BatchPermit;
  };
}

interface ApprovalNeededResponse {
  needsApproval: true;
  approvalType: 'ERC20_TO_PERMIT2';
  approvalTokenAddress: string;
  approvalTokenSymbol: TokenSymbol;
  approveToAddress: string;
  approvalAmount: string;
  erc20ApprovalNeeded: boolean;
  needsToken0Approval: boolean;
  needsToken1Approval: boolean;
}

/**
 * Returned when an off-chain Permit2 batch signature is required. May ALSO carry
 * ERC-20 approval fields when `erc20ApprovalNeeded` is true — the frontend then
 * builds steps for both the on-chain approve(s) AND the off-chain signature in a
 * single context (matches master's pre-sunset shape).
 */
interface PermitSignatureNeededResponse {
  needsApproval: true;
  approvalType: 'PERMIT2_BATCH_SIGNATURE';
  permitBatchData: import('@/lib/liquidity/uniswap-api/client').V4BatchPermit;
  signatureDetails: {
    domain: { name: string; chainId: number; verifyingContract: string };
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
  };
  erc20ApprovalNeeded?: boolean;
  approvalTokenAddress?: string;
  approvalTokenSymbol?: TokenSymbol;
  approveToAddress?: string;
  approvalAmount?: string;
  needsToken0Approval?: boolean;
  needsToken1Approval?: boolean;
}

interface TransactionPreparedResponse {
  needsApproval: false;
  create: { to: string; from?: string; data: string; value: string; chainId: number; gasLimit?: string };
  transaction: { to: string; data: string; value: string; gasLimit?: string };
  sqrtRatioX96: string;
  currentTick: number;
  poolLiquidity: string;
  deadline: string;
  /** Estimated gas cost in wei from API simulation. */
  gasFee?: string;
  details: {
    token0: { address: string; symbol: string; amount: string };
    token1: { address: string; symbol: string; amount: string };
    tickLower: number;
    tickUpper: number;
  };
}

type PrepareMintTxResponse = ApprovalNeededResponse | PermitSignatureNeededResponse | TransactionPreparedResponse | { message: string; error?: any };

function normalizeAmountString(raw: string): string {
  let s = (raw ?? '').toString().trim().replace(/,/g, '.');
  if (!/e|E/.test(s)) return s;
  const match = s.match(/^([+-]?)(\d*\.?\d+)[eE]([+-]?\d+)$/);
  if (!match) return s;
  const sign = match[1] || '';
  const num = match[2];
  const exp = parseInt(match[3], 10);
  const parts = num.split('.');
  const intPart = parts[0] || '0';
  const fracPart = parts[1] || '';
  const digits = (intPart + fracPart).replace(/^0+/, '') || '0';
  const pointIndex = intPart.length;
  const newPoint = pointIndex + exp;
  if (exp >= 0) {
    if (newPoint >= digits.length) return sign + digits + '0'.repeat(newPoint - digits.length);
    return sign + digits.slice(0, newPoint) + '.' + digits.slice(newPoint);
  }
  if (newPoint <= 0) return sign + '0.' + '0'.repeat(-newPoint) + digits;
  return sign + digits.slice(0, newPoint) + '.' + digits.slice(newPoint);
}

export default async function handler(
  req: PrepareMintTxRequest,
  res: NextApiResponse<PrepareMintTxResponse>,
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
  const rateCheck = checkTxRateLimit(clientIp);
  if (!rateCheck.allowed) {
    res.setHeader('Retry-After', String(rateCheck.retryAfter || 60));
    return res.status(429).json({ message: 'Too many requests. Please try again later.' });
  }

  const networkMode = resolveNetworkMode(req);
  const publicClient = createNetworkClient(networkMode);
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
      slippageBps = 50,
      deadlineMinutes = 30,
      permitSignature,
      permitBatchData,
    } = req.body;

    const chainIdError = validateChainId(chainId, networkMode);
    if (chainIdError) return res.status(400).json({ message: chainIdError });
    if (!isAddress(userAddress)) return res.status(400).json({ message: 'Invalid userAddress.' });

    const token0Config = getToken(token0Symbol, networkMode);
    const token1Config = getToken(token1Symbol, networkMode);
    const inputTokenConfig = getToken(inputTokenSymbol, networkMode);
    if (!token0Config || !token1Config || !inputTokenConfig) {
      return res.status(400).json({ message: 'Invalid token symbol(s) provided.' });
    }
    if (isNaN(parseFloat(inputAmount)) || parseFloat(inputAmount) <= 0) {
      return res.status(400).json({ message: 'Invalid inputAmount.' });
    }
    if (typeof userTickLower !== 'number' || typeof userTickUpper !== 'number') {
      return res.status(400).json({ message: 'userTickLower and userTickUpper must be numbers.' });
    }

    const requestPoolId = req.body.poolId;
    const poolConfig = requestPoolId
      ? getPoolBySlugMultiChain(requestPoolId)
      : getPoolByTokens(token0Symbol, token1Symbol, networkMode);
    if (!poolConfig) {
      return res.status(400).json({ message: `No pool configuration found for ${requestPoolId || `${token0Symbol}/${token1Symbol}`}` });
    }
    if (isUnifiedYieldPool(poolConfig)) {
      return res.status(400).json({ message: 'Unified Yield positions use a separate deposit flow.' });
    }

    // /lp/create requires ticks aligned to the pool's tickSpacing — misaligned values
    // return a 500 Internal Error from Uniswap. Clamp to absolute bounds then snap.
    const clampedLower = Math.max(userTickLower, TickMath.MIN_TICK);
    const clampedUpper = Math.min(userTickUpper, TickMath.MAX_TICK);
    let tickLower = nearestUsableTick(clampedLower, poolConfig.tickSpacing);
    let tickUpper = nearestUsableTick(clampedUpper, poolConfig.tickSpacing);
    if (tickLower >= tickUpper) {
      return res.status(400).json({ message: 'tickLower must be less than tickUpper.' });
    }

    if (inputTokenSymbol !== token0Symbol && inputTokenSymbol !== token1Symbol) {
      return res.status(400).json({ message: 'inputTokenSymbol must match token0Symbol or token1Symbol.' });
    }

    const normalizedInput = normalizeAmountString(inputAmount);
    const parsedInputAmount = parseUnits(normalizedInput, inputTokenConfig.decimals);

    // Reject partial permit payloads — indicates a client-side bug.
    if ((permitSignature == null) !== (permitBatchData == null)) {
      return res.status(400).json({ message: 'permitSignature and permitBatchData must be provided together.' });
    }
    const hasSignedPermit = !!(permitSignature && permitBatchData);

    const inputTokenAddress = inputTokenSymbol === token0Symbol
      ? getAddress(token0Config.address)
      : getAddress(token1Config.address);
    const deadlineSeconds = Math.floor(Date.now() / 1000) + deadlineMinutes * 60;

    // Step 1: build the create tx. Without a signed permit we simulate to get amounts
    // and gas; with a permit we skip simulation (Uniswap's simulator 502s on hooked
    // pools with real permits) and trust the wallet to estimate gas before broadcast.
    const createResponse = await uniswapLPAPI.create({
      walletAddress: getAddress(userAddress),
      chainId,
      protocol: 'V4',
      existingPool: {
        token0Address: getAddress(token0Config.address),
        token1Address: getAddress(token1Config.address),
        poolReference: poolConfig.poolId,
      },
      independentToken: { tokenAddress: inputTokenAddress, amount: parsedInputAmount.toString() },
      tickBounds: { tickLower, tickUpper },
      slippageTolerance: slippageBps / 100,
      deadline: deadlineSeconds,
      ...(hasSignedPermit ? { batchPermitData: denormalizeV4BatchPermit(permitBatchData!), signature: permitSignature } : {}),
      simulateTransaction: !hasSignedPermit,
    });

    // Step 2: if no permit was provided yet, use the real token amounts from step 1
    // to check approvals. Passing real amounts (vs the inflated input-wei-for-both
    // approach) lets Uniswap correctly report that no approval is needed when the
    // user already has sufficient allowance — fixes the "always approving" UX bug.
    if (!hasSignedPermit) {
      const t0Addr = getAddress(token0Config.address);
      const t1Addr = getAddress(token1Config.address);
      const approvalCheck = await uniswapLPAPI.checkApproval({
        walletAddress: getAddress(userAddress),
        chainId,
        protocol: 'V4',
        lpTokens: [
          { tokenAddress: t0Addr, amount: createResponse.token0.amount },
          { tokenAddress: t1Addr, amount: createResponse.token1.amount },
        ],
        action: 'CREATE',
      });

      const needsToken0Approval = approvalCheck.transactions.some(t =>
        getAddress(t.tokenAddress ?? t.transaction.to).toLowerCase() === t0Addr.toLowerCase());
      const needsToken1Approval = approvalCheck.transactions.some(t =>
        getAddress(t.tokenAddress ?? t.transaction.to).toLowerCase() === t1Addr.toLowerCase());
      const firstApproval = approvalCheck.transactions[0];
      // Decode the real spender (Permit2) from approve(address,uint256) calldata.
      // `transaction.to` is the token contract — using it as the spender would call
      // approve(token, max) on the token itself (a no-op), leaving Permit2 at zero
      // allowance and reverting the mint with TRANSFER_FROM_FAILED.
      const decodeApproveSpender = (data: string): `0x${string}` =>
        getAddress(`0x${data.slice(34, 74)}`);
      const erc20Fields = firstApproval ? {
        erc20ApprovalNeeded: true as const,
        approvalTokenAddress: getAddress(firstApproval.tokenAddress ?? firstApproval.transaction.to),
        approvalTokenSymbol: (getAddress(firstApproval.tokenAddress ?? firstApproval.transaction.to).toLowerCase() === t0Addr.toLowerCase()
          ? token0Symbol : token1Symbol) as TokenSymbol,
        approveToAddress: decodeApproveSpender(firstApproval.transaction.data),
        approvalAmount: maxUint256.toString(),
        needsToken0Approval,
        needsToken1Approval,
      } : null;

      if (approvalCheck.v4BatchPermitData) {
        const v4 = normalizeV4BatchPermit(approvalCheck.v4BatchPermitData, chainId);
        const primaryType = Object.keys(v4.types).find(k => k !== 'EIP712Domain') ?? 'PermitBatch';
        return res.status(200).json({
          needsApproval: true,
          approvalType: 'PERMIT2_BATCH_SIGNATURE',
          permitBatchData: v4,
          signatureDetails: { domain: v4.domain, types: v4.types, primaryType },
          ...(erc20Fields ?? {}),
        });
      }
      if (erc20Fields) {
        return res.status(200).json({
          needsApproval: true,
          approvalType: 'ERC20_TO_PERMIT2',
          ...erc20Fields,
        });
      }
      // Fully provisioned: createResponse already holds the final tx; fall through.
    }

    const response = createResponse;

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

    const deadlineBigInt = BigInt(deadlineSeconds);

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
      gasFee: response.gasFee,
      details: {
        token0: { address: getAddress(token0Config.address), symbol: token0Symbol, amount: response.token0.amount },
        token1: { address: getAddress(token1Config.address), symbol: token1Symbol, amount: response.token1.amount },
        tickLower: response.tickLower,
        tickUpper: response.tickUpper,
      },
    });
  } catch (error: any) {
    if (error instanceof UniswapLPAPIRateLimitError) {
      console.warn('[prepare-mint-tx] Rate limit exhausted after retries');
      res.setHeader('Retry-After', '2');
      return res.status(429).json({ message: 'Busy — please retry in a moment.' });
    }
    if (error instanceof UniswapLPAPIError) {
      console.error('[prepare-mint-tx] Uniswap LP API error:', error.status, error.message);
      Sentry.captureException(error, {
        tags: { route: 'prepare-mint-tx', source: 'uniswap_lp_api', uniswap_status: String(error.status) },
        extra: { userAddress: req.body?.userAddress, poolId: req.body?.poolId, chainId: req.body?.chainId, tickLower: req.body?.userTickLower, tickUpper: req.body?.userTickUpper },
      });
      return res.status(error.status >= 500 ? 502 : 400).json({ message: `Uniswap LP API: ${error.message}` });
    }
    console.error('[API prepare-mint-tx] Error:', error);
    Sentry.captureException(error, {
      tags: { route: 'prepare-mint-tx', source: 'internal' },
      extra: { userAddress: req.body?.userAddress, poolId: req.body?.poolId, chainId: req.body?.chainId },
    });
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
    return res.status(500).json({ message: errorMessage, error: process.env.NODE_ENV === 'development' ? error : undefined });
  }
}
