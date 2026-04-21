/**
 * prepare-increase-tx.ts — route non-UY V4 increase liquidity through Uniswap's LP API.
 *
 * Approvals are discovered via /lp/check_approval and surfaced as ERC20_TO_PERMIT2
 * steps for the existing frontend. Once approvals clear, /lp/increase returns the
 * final transaction.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { getAllPools } from '@/lib/pools-config';
import { resolveNetworkMode } from '@/lib/network-mode';
import { validateChainId, checkTxRateLimit } from '@/lib/tx-validation';
import { createNetworkClient } from '@/lib/viemClient';
import { getPositionDetails } from '@/lib/liquidity/liquidity-utils';
import { safeParseUnits } from '@/lib/liquidity/utils/parsing/amountParsing';
import { findPoolByPoolKey, isUnifiedYieldPool } from '@/lib/liquidity/utils/pool-type-guards';
import { uniswapLPAPI, UniswapLPAPIError, normalizeV4BatchPermit, denormalizeV4BatchPermit } from '@/lib/liquidity/uniswap-api/client';
import { getTokenSymbolByAddress, getToken } from '@/lib/pools-config';
import { isAddress, getAddress, maxUint256, zeroAddress, type Hex } from 'viem';

import { STATE_VIEW_ABI as STATE_VIEW_HUMAN_READABLE_ABI } from '@/lib/abis/state_view_abi';
import { getStateViewAddress } from '@/lib/pools-config';
import { parseAbi } from 'viem';

interface PrepareIncreaseTxRequest extends NextApiRequest {
  body: {
    userAddress: string;
    tokenId: string;
    amount0: string;
    amount1: string;
    chainId: number;
    slippageBps?: number;
    deadlineMinutes?: number;
    /** EIP-712 signature over the v4BatchPermitData typed data. */
    permitSignature?: string;
    /** Normalized batch permit data (echoed from prepare-increase-tx's first response). Denormalized before forwarding to /lp/increase. */
    permitBatchData?: import('@/lib/liquidity/uniswap-api/client').V4BatchPermit;
  };
}

interface ApprovalNeededResponse {
  needsApproval: true;
  approvalType: 'ERC20_TO_PERMIT2';
  approvalTokenAddress: string;
  approvalTokenSymbol?: string;
  approveToAddress: string;
  approvalAmount: string;
  needsToken0Approval: boolean;
  needsToken1Approval: boolean;
}

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
  approvalTokenSymbol?: string;
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
    liquidity: string;
    tickLower: number;
    tickUpper: number;
  };
}

type PrepareIncreaseTxResponse = ApprovalNeededResponse | PermitSignatureNeededResponse | TransactionPreparedResponse | { message: string; error?: any };

export default async function handler(
  req: PrepareIncreaseTxRequest,
  res: NextApiResponse<PrepareIncreaseTxResponse>,
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

  try {
    const {
      userAddress,
      tokenId,
      amount0: inputAmount0,
      amount1: inputAmount1,
      chainId,
      slippageBps = 50,
      deadlineMinutes = 30,
      permitSignature,
      permitBatchData,
    } = req.body;

    const chainIdError = validateChainId(chainId, networkMode);
    if (chainIdError) return res.status(400).json({ message: chainIdError });
    if (!isAddress(userAddress)) return res.status(400).json({ message: 'Invalid userAddress.' });
    if (!tokenId) return res.status(400).json({ message: 'Missing tokenId.' });

    const nftTokenId = BigInt(tokenId);

    const details = await getPositionDetails(nftTokenId, chainId);
    const poolConfig = findPoolByPoolKey(getAllPools(networkMode), details.poolKey);
    if (!poolConfig) {
      return res.status(400).json({ message: 'Position is not in an Alphix pool.' });
    }
    if (isUnifiedYieldPool(poolConfig)) {
      return res.status(400).json({ message: 'Unified Yield positions use a separate deposit flow.' });
    }

    const sym0 = getTokenSymbolByAddress(details.poolKey.currency0, networkMode);
    const sym1 = getTokenSymbolByAddress(details.poolKey.currency1, networkMode);
    const defC0 = sym0 ? getToken(sym0, networkMode) : null;
    const defC1 = sym1 ? getToken(sym1, networkMode) : null;
    if (!defC0 || !defC1) {
      return res.status(400).json({ message: 'Token metadata missing for this position.' });
    }
    const isNativeC0 = getAddress(details.poolKey.currency0) === zeroAddress;
    const isNativeC1 = getAddress(details.poolKey.currency1) === zeroAddress;

    const amountC0Raw = safeParseUnits(inputAmount0 || '0', defC0.decimals);
    const amountC1Raw = safeParseUnits(inputAmount1 || '0', defC1.decimals);
    if (amountC0Raw === 0n && amountC1Raw === 0n) {
      return res.status(400).json({ message: 'Please enter a valid amount to add.' });
    }

    // Skip approval check if frontend already has a signed Permit2 batch in hand.
    const hasSignedPermit = !!(permitSignature && permitBatchData);

    if (!hasSignedPermit) {
      const approvalCheck = await uniswapLPAPI.checkApproval({
        walletAddress: getAddress(userAddress),
        chainId,
        protocol: 'V4',
        lpTokens: [
          { tokenAddress: details.poolKey.currency0, amount: amountC0Raw.toString() },
          { tokenAddress: details.poolKey.currency1, amount: amountC1Raw.toString() },
        ].filter(t => BigInt(t.amount) > 0n),
        action: 'INCREASE',
      });

      const c0 = getAddress(details.poolKey.currency0);
      const c1 = getAddress(details.poolKey.currency1);
      const needsToken0Approval = approvalCheck.transactions.some(t =>
        getAddress(t.tokenAddress ?? t.transaction.to).toLowerCase() === c0.toLowerCase());
      const needsToken1Approval = approvalCheck.transactions.some(t =>
        getAddress(t.tokenAddress ?? t.transaction.to).toLowerCase() === c1.toLowerCase());
      const firstApproval = approvalCheck.transactions[0];
      const erc20Fields = firstApproval ? {
        erc20ApprovalNeeded: true as const,
        approvalTokenAddress: getAddress(firstApproval.tokenAddress ?? firstApproval.transaction.to),
        approvalTokenSymbol: getAddress(firstApproval.tokenAddress ?? firstApproval.transaction.to).toLowerCase() === c0.toLowerCase()
          ? defC0.symbol : defC1.symbol,
        approveToAddress: firstApproval.transaction.to,
        approvalAmount: maxUint256.toString(),
        needsToken0Approval,
        needsToken1Approval,
      } : null;

      // Prefer signed-permit path; include ERC-20 fields alongside when also needed.
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
    }

    // 2. Build increase tx.
    const independentIsToken0 = amountC0Raw > 0n;
    const deadlineSeconds = Math.floor(Date.now() / 1000) + deadlineMinutes * 60;

    const response = await uniswapLPAPI.increase({
      walletAddress: getAddress(userAddress),
      chainId,
      protocol: 'V4',
      token0Address: details.poolKey.currency0,
      token1Address: details.poolKey.currency1,
      nftTokenId: nftTokenId.toString(),
      independentToken: {
        tokenAddress: independentIsToken0 ? details.poolKey.currency0 : details.poolKey.currency1,
        amount: (independentIsToken0 ? amountC0Raw : amountC1Raw).toString(),
      },
      slippageTolerance: slippageBps / 100,
      deadline: deadlineSeconds,
      ...(hasSignedPermit ? { v4BatchPermitData: denormalizeV4BatchPermit(permitBatchData!), signature: permitSignature } : {}),
      simulateTransaction: true,
    });

    const stateViewAbiViem = parseAbi(STATE_VIEW_HUMAN_READABLE_ABI);
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
        to: response.increase.to,
        from: response.increase.from,
        data: response.increase.data,
        value: response.increase.value,
        chainId,
      },
      transaction: {
        to: response.increase.to,
        data: response.increase.data,
        value: response.increase.value,
      },
      sqrtRatioX96: slot0[0].toString(),
      currentTick: slot0[1],
      poolLiquidity: curLiquidity.toString(),
      deadline: deadlineBigInt.toString(),
      gasFee: response.gasFee,
      details: {
        token0: { address: isNativeC0 ? zeroAddress : getAddress(defC0.address), symbol: defC0.symbol, amount: response.token0.amount },
        token1: { address: isNativeC1 ? zeroAddress : getAddress(defC1.address), symbol: defC1.symbol, amount: response.token1.amount },
        liquidity: '0',
        tickLower: details.tickLower,
        tickUpper: details.tickUpper,
      },
    });
  } catch (error: any) {
    if (error instanceof UniswapLPAPIError) {
      console.error('[prepare-increase-tx] Uniswap LP API error:', error.status, error.message);
      return res.status(error.status >= 500 ? 502 : 400).json({ message: `Uniswap LP API: ${error.message}` });
    }
    console.error('[API prepare-increase-tx] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
    return res.status(500).json({ message: errorMessage, error: process.env.NODE_ENV === 'development' ? error : undefined });
  }
}
