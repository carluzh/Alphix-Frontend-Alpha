/**
 * prepare-increase-tx.ts - API route for preparing increase liquidity transactions
 *
 * Following the Uniswap pattern from prepare-mint-tx.ts:
 * 1. Checks ERC20 allowances (returns needsApproval + ERC20_TO_PERMIT2)
 * 2. Checks Permit2 allowances (returns needsApproval + PERMIT2_BATCH_SIGNATURE)
 * 3. Builds transaction calldata using V4PositionManager.addCallParameters
 *
 * @see pages/api/liquidity/prepare-mint-tx.ts
 * @see interface/apps/web/src/pages/IncreaseLiquidity/IncreaseLiquidityTxContext.tsx
 */

import { Token, Percent, Ether, CurrencyAmount } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position, V4PositionManager } from "@uniswap/v4-sdk";
import type { AddLiquidityOptions, AllowanceTransferPermitBatch } from "@uniswap/v4-sdk";
import JSBI from 'jsbi';
import type { NextApiRequest, NextApiResponse } from 'next';

import { STATE_VIEW_ABI as STATE_VIEW_HUMAN_READABLE_ABI } from "@/lib/abis/state_view_abi";
import { TokenSymbol, getToken, getPositionManagerAddress, getStateViewAddress, getNetworkModeFromRequest, getTokenSymbolByAddress } from "@/lib/pools-config";
import { validateChainId, checkTxRateLimit } from "@/lib/tx-validation";
import { iallowance_transfer_abi } from "@/lib/abis/IAllowanceTransfer_abi";
import { createNetworkClient } from "@/lib/viemClient";
import { getPositionDetails, getPoolState } from "@/lib/liquidity/liquidity-utils";
import { safeParseUnits } from "@/lib/liquidity/utils/parsing/amountParsing";
import {
  isAddress,
  getAddress,
  parseAbi,
  maxUint256,
  encodeAbiParameters,
  keccak256,
  type Hex
} from "viem";

import {
  PERMIT_EXPIRATION_DURATION_SECONDS,
  PERMIT_SIG_DEADLINE_DURATION_SECONDS,
} from "@/lib/swap/swap-constants";
import { AllowanceTransfer, permit2Address, PERMIT2_ADDRESS, PermitBatch } from '@uniswap/permit2-sdk';

const ETHERS_ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";

interface PrepareIncreaseTxRequest extends NextApiRequest {
  body: {
    userAddress: string;
    tokenId: string; // NFT token ID (numeric string)
    amount0: string; // Amount of token0 to add
    amount1: string; // Amount of token1 to add
    chainId: number;
    // User settings (optional - defaults provided)
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

// Approval needed response
interface ApprovalNeededResponse {
  needsApproval: true;
  approvalType: 'ERC20_TO_PERMIT2' | 'PERMIT2_BATCH_SIGNATURE';
  approvalTokenAddress?: string;
  approvalTokenSymbol?: string;
  approveToAddress?: string;
  approvalAmount?: string;
  // Permit data is included for BOTH types - ERC20_TO_PERMIT2 includes it for after approval
  permitBatchData?: any;
  signatureDetails?: {
    domain: {
      name: string;
      chainId: number;
      verifyingContract: Hex;
      version?: string;
    };
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: 'PermitBatch';
  };
}

// Transaction ready response (matches prepare-mint-tx.ts format)
interface TransactionPreparedResponse {
  needsApproval: false;
  create: {
    to: string;
    from?: string;
    data: string;
    value: string;
    chainId: number;
    gasLimit?: string;
  };
  transaction: {
    to: string;
    data: string;
    value: string;
    gasLimit?: string;
  };
  sqrtRatioX96: string;
  currentTick: number;
  poolLiquidity: string;
  deadline: string;
  details: {
    token0: { address: string; symbol: string; amount: string };
    token1: { address: string; symbol: string; amount: string };
    liquidity: string;
    tickLower: number;
    tickUpper: number;
  };
}

type PrepareIncreaseTxResponse = ApprovalNeededResponse | TransactionPreparedResponse | { message: string; error?: any };

export default async function handler(
  req: PrepareIncreaseTxRequest,
  res: NextApiResponse<PrepareIncreaseTxResponse>
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

  // Get network mode from cookies
  const networkMode = getNetworkModeFromRequest(req.headers.cookie);
  const publicClient = createNetworkClient(networkMode);
  const POSITION_MANAGER_ADDRESS = getPositionManagerAddress(networkMode);
  const STATE_VIEW_ADDRESS = getStateViewAddress(networkMode);
  const stateViewAbiViem = parseAbi(STATE_VIEW_HUMAN_READABLE_ABI);

  try {
    const {
      userAddress,
      tokenId,
      amount0: inputAmount0,
      amount1: inputAmount1,
      chainId,
      slippageBps = 50,
      deadlineMinutes = 20,
    } = req.body;

    // Validate inputs
    const chainIdError = validateChainId(chainId, networkMode);
    if (chainIdError) {
      return res.status(400).json({ message: chainIdError });
    }

    if (!isAddress(userAddress)) {
      return res.status(400).json({ message: "Invalid userAddress." });
    }

    if (!tokenId) {
      return res.status(400).json({ message: "Missing tokenId." });
    }

    const nftTokenId = BigInt(tokenId);

    // Fetch on-chain position details
    const details = await getPositionDetails(nftTokenId, chainId);

    // Get token symbols from pool key addresses
    const symC0 = getTokenSymbolByAddress(getAddress(details.poolKey.currency0), networkMode);
    const symC1 = getTokenSymbolByAddress(getAddress(details.poolKey.currency1), networkMode);
    if (!symC0 || !symC1) {
      return res.status(400).json({ message: 'Token symbols not found for pool currencies' });
    }

    const defC0 = getToken(symC0, networkMode);
    const defC1 = getToken(symC1, networkMode);
    if (!defC0 || !defC1) {
      return res.status(400).json({ message: 'Token definitions not found' });
    }

    const isNativeC0 = getAddress(details.poolKey.currency0) === ETHERS_ADDRESS_ZERO;
    const isNativeC1 = getAddress(details.poolKey.currency1) === ETHERS_ADDRESS_ZERO;
    const currency0 = isNativeC0 ? Ether.onChain(chainId) : new Token(chainId, getAddress(defC0.address), defC0.decimals, defC0.symbol);
    const currency1 = isNativeC1 ? Ether.onChain(chainId) : new Token(chainId, getAddress(defC1.address), defC1.decimals, defC1.symbol);

    // Get pool state
    const keyTuple = [{
      currency0: getAddress(details.poolKey.currency0),
      currency1: getAddress(details.poolKey.currency1),
      fee: Number(details.poolKey.fee),
      tickSpacing: Number(details.poolKey.tickSpacing),
      hooks: getAddress(details.poolKey.hooks),
    }];
    const encoded = encodeAbiParameters([
      { type: 'tuple', components: [
        { name: 'currency0', type: 'address' },
        { name: 'currency1', type: 'address' },
        { name: 'fee', type: 'uint24' },
        { name: 'tickSpacing', type: 'int24' },
        { name: 'hooks', type: 'address' },
      ]}
    ], keyTuple as any);
    const poolId = keccak256(encoded) as Hex;
    const state = await getPoolState(poolId, chainId);

    // Build pool
    const pool = new V4Pool(
      currency0 as any,
      currency1,
      details.poolKey.fee,
      details.poolKey.tickSpacing,
      details.poolKey.hooks,
      JSBI.BigInt(state.sqrtPriceX96.toString()),
      JSBI.BigInt(state.liquidity.toString()),
      state.tick,
    );

    // Parse amounts (amounts are already in pool key order from UI)
    let amountC0Raw = safeParseUnits(inputAmount0 || "0", defC0.decimals);
    let amountC1Raw = safeParseUnits(inputAmount1 || "0", defC1.decimals);

    // Handle out-of-range positions
    const outOfRangeBelow = state.tick < details.tickLower;
    const outOfRangeAbove = state.tick > details.tickUpper;
    if (outOfRangeBelow) {
      amountC1Raw = 0n;
    } else if (outOfRangeAbove) {
      amountC0Raw = 0n;
    }

    if (amountC0Raw === 0n && amountC1Raw === 0n) {
      return res.status(400).json({ message: 'Please enter a valid amount to add.' });
    }

    // Build position using SDK
    let position: V4Position;
    const userProvidedAmount0 = amountC0Raw > 0n;
    const userProvidedAmount1 = amountC1Raw > 0n;

    if (userProvidedAmount0 && !userProvidedAmount1) {
      const amt0 = CurrencyAmount.fromRawAmount(currency0, amountC0Raw.toString());
      position = V4Position.fromAmount0({
        pool,
        tickLower: details.tickLower,
        tickUpper: details.tickUpper,
        amount0: amt0.quotient,
        useFullPrecision: true,
      });
    } else if (userProvidedAmount1 && !userProvidedAmount0) {
      const amt1 = CurrencyAmount.fromRawAmount(currency1, amountC1Raw.toString());
      position = V4Position.fromAmount1({
        pool,
        tickLower: details.tickLower,
        tickUpper: details.tickUpper,
        amount1: amt1.quotient,
      });
    } else {
      const amt0 = CurrencyAmount.fromRawAmount(currency0, amountC0Raw.toString());
      const amt1 = CurrencyAmount.fromRawAmount(currency1, amountC1Raw.toString());
      position = V4Position.fromAmounts({
        pool,
        tickLower: details.tickLower,
        tickUpper: details.tickUpper,
        amount0: amt0.quotient,
        amount1: amt1.quotient,
        useFullPrecision: true,
      });
    }

    // Check for zero liquidity
    if (JSBI.equal(position.liquidity, JSBI.BigInt(0))) {
      return res.status(400).json({ message: 'Amount too small, please try a larger amount.' });
    }

    // Get actual amounts from position
    const SLIPPAGE_TOLERANCE = new Percent(slippageBps, 10_000);
    const slippageAmounts = position.mintAmountsWithSlippage(SLIPPAGE_TOLERANCE);
    const amount0ForPermit = BigInt(slippageAmounts.amount0.toString());
    const amount1ForPermit = BigInt(slippageAmounts.amount1.toString());

    // Debug logging for permit amounts
    console.log('[prepare-increase-tx] Permit amounts:', {
      token0: { symbol: defC0.symbol, inputAmount: amountC0Raw.toString(), permitAmount: amount0ForPermit.toString(), isNative: isNativeC0 },
      token1: { symbol: defC1.symbol, inputAmount: amountC1Raw.toString(), permitAmount: amount1ForPermit.toString(), isNative: isNativeC1 },
    });

    // Extract permit data
    const { permitSignature: batchPermitSignature, permitBatchData } = req.body;
    const hasBatchPermit = batchPermitSignature && permitBatchData;

    // Tokens to check
    const tokensToCheck = [
      { address: isNativeC0 ? ETHERS_ADDRESS_ZERO : getAddress(defC0.address), requiredAmount: amountC0Raw, permitAmount: amount0ForPermit, symbol: defC0.symbol, isNative: isNativeC0, decimals: defC0.decimals },
      { address: isNativeC1 ? ETHERS_ADDRESS_ZERO : getAddress(defC1.address), requiredAmount: amountC1Raw, permitAmount: amount1ForPermit, symbol: defC1.symbol, isNative: isNativeC1, decimals: defC1.decimals }
    ];

    // Filter to ERC20 tokens that need checking
    const erc20TokensToCheck = tokensToCheck.filter(t => !t.isNative && t.requiredAmount > 0n);

    // Track which tokens need ERC20 approval to Permit2
    // Fix: Track BOTH tokens separately to handle cases where both need approval
    let erc20ApprovalNeeded: { address: string; symbol: string } | null = null;
    let needsToken0Approval = false;
    let needsToken1Approval = false;

    // Token0 address from pool key for comparison (used in both ERC20 and Permit2 checks)
    const token0Address = getAddress(details.poolKey.currency0);

    // Check ERC20 allowances to Permit2
    if (erc20TokensToCheck.length > 0) {
      const erc20AllowanceAbi = parseAbi(['function allowance(address,address) view returns (uint256)']);
      const erc20AllowanceResults = await publicClient.multicall({
        contracts: erc20TokensToCheck.map(t => ({
          address: t.address as `0x${string}`,
          abi: erc20AllowanceAbi,
          functionName: 'allowance',
          args: [getAddress(userAddress), PERMIT2_ADDRESS]
        })),
        allowFailure: false,
      });

      // Use permitAmount (slippage-adjusted) for the check to ensure approval covers actual transfer
      for (let i = 0; i < erc20TokensToCheck.length; i++) {
        const t = erc20TokensToCheck[i];
        const allowance = erc20AllowanceResults[i] as bigint;

        if (allowance < t.permitAmount) {
          // Track which specific token needs approval
          const isToken0 = getAddress(t.address).toLowerCase() === token0Address.toLowerCase();
          if (isToken0) {
            needsToken0Approval = true;
          } else {
            needsToken1Approval = true;
          }

          // Keep backwards compatibility: store first token info for legacy clients
          if (!erc20ApprovalNeeded) {
            erc20ApprovalNeeded = { address: t.address, symbol: t.symbol };
          }
          // Continue checking all tokens - don't break
        }
      }
    }

    // Generate permit data (needed for both ERC20_TO_PERMIT2 and PERMIT2_BATCH_SIGNATURE flows)
    // This ensures frontend can build complete step list upfront
    let permitBatchDataResponse: any = null;
    let signatureDetailsResponse: any = null;

    if (!hasBatchPermit) {
      const latestBlock = await publicClient.getBlock({ blockTag: 'latest' });
      if (!latestBlock) throw new Error("Failed to get latest block");

      const PERMIT_EXPIRATION_MS = PERMIT_EXPIRATION_DURATION_SECONDS * 1000;
      const PERMIT_SIG_EXPIRATION_MS = PERMIT_SIG_DEADLINE_DURATION_SECONDS * 1000;
      const currentTimestamp = Number(latestBlock.timestamp);
      const toDeadline = (expiration: number): number => currentTimestamp + Math.floor(expiration / 1000);

      const permitsNeeded: Array<{
        token: string;
        amount: string;
        expiration: string;
        nonce: string;
      }> = [];

      const permit2TokensToCheck = tokensToCheck.filter(t => !t.isNative && t.permitAmount > 0n);

      if (permit2TokensToCheck.length > 0) {
        const permit2AllowanceResults = await publicClient.multicall({
          contracts: permit2TokensToCheck.map(t => ({
            address: PERMIT2_ADDRESS as `0x${string}`,
            abi: iallowance_transfer_abi as any,
            functionName: 'allowance' as const,
            args: [getAddress(userAddress), t.address, POSITION_MANAGER_ADDRESS] as const
          })),
          allowFailure: false,
        });

        permit2TokensToCheck.forEach((t, i) => {
          const [permitAmt, permitExp, permitNonce] = permit2AllowanceResults[i] as readonly [bigint, number, number];
          const hasValidPermit = permitAmt >= t.permitAmount && permitExp > currentTimestamp;

          // If ERC20 approval is needed for this token, always include permit data regardless of existing Permit2 allowance.
          // This ensures the frontend step flow works correctly: [approval] -> [permit] -> [tx]
          // Fix: Use the new per-token flags instead of legacy single-token check
          const isToken0 = getAddress(t.address).toLowerCase() === token0Address.toLowerCase();
          const isTokenNeedingApproval = isToken0 ? needsToken0Approval : needsToken1Approval;

          if (hasValidPermit && !isTokenNeedingApproval) return;

          permitsNeeded.push({
            token: t.address,
            amount: t.permitAmount.toString(),
            expiration: toDeadline(PERMIT_EXPIRATION_MS).toString(),
            nonce: permitNonce.toString(),
          });
        });
      }

      if (permitsNeeded.length > 0) {
        // Debug logging for permits being requested
        console.log('[prepare-increase-tx] Building permit batch with individual amounts:', {
          permitsNeeded: permitsNeeded.map(p => ({
            token: p.token,
            amount: p.amount,
          })),
        });

        const permit = {
          details: permitsNeeded,
          spender: POSITION_MANAGER_ADDRESS,
          sigDeadline: toDeadline(PERMIT_SIG_EXPIRATION_MS).toString(),
        };

        const permitData = AllowanceTransfer.getPermitData(permit, permit2Address(chainId), chainId);

        // Debug logging for permit data from SDK
        console.log('[prepare-increase-tx] SDK permitData.values.details:',
          (permitData.values as any).details?.map((d: any) => ({ token: d.token, amount: d.amount?.toString() }))
        );

        if (!('details' in permitData.values) || !Array.isArray(permitData.values.details)) {
          throw new Error('Expected PermitBatch data structure');
        }

        const { domain, types, values } = permitData as {
          domain: typeof permitData.domain;
          types: typeof permitData.types;
          values: PermitBatch;
        };

        permitBatchDataResponse = {
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
        };

        signatureDetailsResponse = {
          domain: {
            name: domain.name || 'Permit2',
            chainId: Number(domain.chainId || chainId),
            verifyingContract: (domain.verifyingContract || PERMIT2_ADDRESS) as `0x${string}`,
          },
          types,
          primaryType: 'PermitBatch',
        };
      }
    }

    // Return ERC20 approval needed response (now includes permit data for complete step generation)
    if (erc20ApprovalNeeded) {
      return res.status(200).json({
        needsApproval: true,
        approvalType: 'ERC20_TO_PERMIT2' as const,
        approvalTokenAddress: erc20ApprovalNeeded.address,
        approvalTokenSymbol: erc20ApprovalNeeded.symbol,
        approveToAddress: PERMIT2_ADDRESS,
        approvalAmount: maxUint256.toString(),
        // New flags: explicitly indicate which tokens need approval
        needsToken0Approval,
        needsToken1Approval,
        // Include permit data so frontend can build complete step list
        permitBatchData: permitBatchDataResponse,
        signatureDetails: signatureDetailsResponse,
      });
    }

    // Return Permit2 signature needed response
    if (permitBatchDataResponse && !hasBatchPermit) {
      return res.status(200).json({
        needsApproval: true,
        approvalType: 'PERMIT2_BATCH_SIGNATURE' as const,
        permitBatchData: permitBatchDataResponse,
        signatureDetails: signatureDetailsResponse,
      });
    }

    // Build transaction
    const latestBlockForTx = await publicClient.getBlock({ blockTag: 'latest' });
    if (!latestBlockForTx) throw new Error("Failed to get latest block for deadline.");
    const deadlineSeconds = BigInt(deadlineMinutes) * 60n;
    const deadlineBigInt = latestBlockForTx.timestamp + deadlineSeconds;

    const permitBatchValues = hasBatchPermit ? (permitBatchData.values || {
      details: permitBatchData.details || [],
      spender: permitBatchData.spender || POSITION_MANAGER_ADDRESS,
      sigDeadline: permitBatchData.sigDeadline || '0'
    }) : null;

    const hasNativeETH = isNativeC0 || isNativeC1;
    let addOptions: AddLiquidityOptions = {
      slippageTolerance: SLIPPAGE_TOLERANCE,
      deadline: deadlineBigInt.toString(),
      tokenId: nftTokenId.toString(),
      hookData: '0x',
      useNative: hasNativeETH ? Ether.onChain(chainId) : undefined,
    };

    if (permitBatchValues) {
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

      addOptions = {
        ...addOptions,
        batchPermit: {
          owner: getAddress(userAddress),
          permitBatch: permitBatchForSDK,
          signature: batchPermitSignature as string,
        }
      };
    }

    const methodParameters = V4PositionManager.addCallParameters(position, addOptions);
    const calldata = methodParameters.calldata;
    const value = methodParameters.value ?? "0";

    // Estimate gas
    let gasLimit: string | undefined;
    try {
      const estimatedGas = await publicClient.estimateGas({
        account: getAddress(userAddress),
        to: POSITION_MANAGER_ADDRESS as `0x${string}`,
        data: calldata as `0x${string}`,
        value: value ? BigInt(value) : undefined,
      });
      gasLimit = ((estimatedGas * 120n) / 100n).toString();
    } catch (e) {
      console.warn('[prepare-increase-tx] Gas estimation failed:', e);
    }

    // Final amounts
    let finalAmount0 = BigInt(position.mintAmounts.amount0.toString());
    let finalAmount1 = BigInt(position.mintAmounts.amount1.toString());
    const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
    if (finalAmount0 >= MAX_UINT256 / 2n) finalAmount0 = 0n;
    if (finalAmount1 >= MAX_UINT256 / 2n) finalAmount1 = 0n;

    return res.status(200).json({
      needsApproval: false,
      create: {
        to: POSITION_MANAGER_ADDRESS,
        from: getAddress(userAddress),
        data: calldata,
        value,
        chainId,
        gasLimit,
      },
      transaction: {
        to: POSITION_MANAGER_ADDRESS,
        data: calldata,
        value,
        gasLimit,
      },
      sqrtRatioX96: state.sqrtPriceX96.toString(),
      currentTick: state.tick,
      poolLiquidity: state.liquidity.toString(),
      deadline: deadlineBigInt.toString(),
      details: {
        token0: { address: isNativeC0 ? ETHERS_ADDRESS_ZERO : getAddress(defC0.address), symbol: defC0.symbol, amount: finalAmount0.toString() },
        token1: { address: isNativeC1 ? ETHERS_ADDRESS_ZERO : getAddress(defC1.address), symbol: defC1.symbol, amount: finalAmount1.toString() },
        liquidity: position.liquidity.toString(),
        tickLower: details.tickLower,
        tickUpper: details.tickUpper,
      }
    });

  } catch (error: any) {
    console.error("[API prepare-increase-tx] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
    return res.status(500).json({ message: errorMessage, error: process.env.NODE_ENV === 'development' ? error : undefined });
  }
}
