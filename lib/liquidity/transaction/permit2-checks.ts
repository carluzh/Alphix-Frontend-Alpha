/**
 * Shared Permit2 approval checking and permit batch data construction.
 *
 * Used by:
 *   - pages/api/liquidity/prepare-mint-tx.ts
 *   - pages/api/liquidity/prepare-increase-tx.ts
 *
 * Eliminates ~300 lines of duplication between the two API routes.
 */

import { getAddress, parseAbi, type Hex, type PublicClient } from 'viem';
import { AllowanceTransfer, permit2Address, PERMIT2_ADDRESS, type PermitBatch } from '@uniswap/permit2-sdk';
import type { AllowanceTransferPermitBatch } from '@uniswap/v4-sdk';
import { iallowance_transfer_abi } from '@/lib/abis/IAllowanceTransfer_abi';
import {
  PERMIT_EXPIRATION_DURATION_SECONDS,
  PERMIT_SIG_DEADLINE_DURATION_SECONDS,
} from '@/lib/swap/swap-constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Unified token descriptor for permit checking */
export interface TokenForPermitCheck {
  address: string;
  requiredAmount: bigint;
  permitAmount: bigint;
  symbol: string;
  isNative: boolean;
}

export interface ERC20ApprovalResult {
  erc20ApprovalNeeded: { address: string; symbol: string } | null;
  needsToken0Approval: boolean;
  needsToken1Approval: boolean;
}

export interface PermitBatchDataResult {
  permitBatchData: {
    domain: any;
    types: any;
    valuesRaw: any;
    values: {
      details: Array<{ token: string; amount: string; expiration: string; nonce: string }>;
      spender: string;
      sigDeadline: string;
    };
  };
  signatureDetails: {
    domain: {
      name: string;
      chainId: number;
      verifyingContract: Hex;
    };
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: 'PermitBatch';
  };
}

// ---------------------------------------------------------------------------
// 1. checkERC20Allowances
// ---------------------------------------------------------------------------

export async function checkERC20Allowances(
  publicClient: PublicClient,
  userAddress: string,
  tokens: [TokenForPermitCheck, TokenForPermitCheck],
  token0Address: string,
): Promise<ERC20ApprovalResult> {
  const erc20TokensToCheck = tokens.filter(t => !t.isNative && t.requiredAmount > 0n);

  let erc20ApprovalNeeded: { address: string; symbol: string } | null = null;
  let needsToken0Approval = false;
  let needsToken1Approval = false;

  if (erc20TokensToCheck.length === 0) {
    return { erc20ApprovalNeeded, needsToken0Approval, needsToken1Approval };
  }

  const erc20AllowanceAbi = parseAbi(['function allowance(address,address) view returns (uint256)']);
  const erc20AllowanceResults = await publicClient.multicall({
    contracts: erc20TokensToCheck.map(t => ({
      address: t.address as `0x${string}`,
      abi: erc20AllowanceAbi,
      functionName: 'allowance',
      args: [getAddress(userAddress), PERMIT2_ADDRESS],
    })),
    allowFailure: false,
    blockTag: 'latest',
  });

  for (let i = 0; i < erc20TokensToCheck.length; i++) {
    const t = erc20TokensToCheck[i];
    const allowance = erc20AllowanceResults[i] as bigint;

    if (allowance < t.permitAmount) {
      const isToken0 = getAddress(t.address).toLowerCase() === getAddress(token0Address).toLowerCase();
      if (isToken0) {
        needsToken0Approval = true;
      } else {
        needsToken1Approval = true;
      }

      if (!erc20ApprovalNeeded) {
        erc20ApprovalNeeded = { address: t.address, symbol: t.symbol };
      }
    }
  }

  return { erc20ApprovalNeeded, needsToken0Approval, needsToken1Approval };
}

// ---------------------------------------------------------------------------
// 2. buildPermitBatchData
// ---------------------------------------------------------------------------

export async function buildPermitBatchData(
  publicClient: PublicClient,
  userAddress: string,
  tokens: [TokenForPermitCheck, TokenForPermitCheck],
  token0Address: string,
  positionManagerAddress: string,
  chainId: number,
  needsToken0Approval: boolean,
  needsToken1Approval: boolean,
): Promise<PermitBatchDataResult | null> {
  const latestBlock = await publicClient.getBlock({ blockTag: 'latest' });
  if (!latestBlock) throw new Error('Failed to get latest block');

  const PERMIT_EXPIRATION_MS = PERMIT_EXPIRATION_DURATION_SECONDS * 1000;
  const PERMIT_SIG_EXPIRATION_MS = PERMIT_SIG_DEADLINE_DURATION_SECONDS * 1000;
  const currentTimestamp = Number(latestBlock.timestamp);
  const toDeadline = (expiration: number): number =>
    currentTimestamp + Math.floor(expiration / 1000);

  const permit2TokensToCheck = tokens.filter(t => !t.isNative && t.permitAmount > 0n);

  const permitsNeeded: Array<{
    token: string;
    amount: string;
    expiration: string;
    nonce: string;
  }> = [];

  if (permit2TokensToCheck.length > 0) {
    const permit2AllowanceResults = await publicClient.multicall({
      contracts: permit2TokensToCheck.map(t => ({
        address: PERMIT2_ADDRESS as `0x${string}`,
        abi: iallowance_transfer_abi as any,
        functionName: 'allowance' as const,
        args: [getAddress(userAddress), t.address, positionManagerAddress] as const,
      })),
      allowFailure: false,
      blockTag: 'latest',
    });

    permit2TokensToCheck.forEach((t, i) => {
      const [permitAmt, permitExp, permitNonce] = permit2AllowanceResults[i] as readonly [bigint, number, number];
      const hasValidPermit = permitAmt >= t.permitAmount && permitExp > currentTimestamp;

      const isToken0 = getAddress(t.address).toLowerCase() === getAddress(token0Address).toLowerCase();
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

  // If no permits needed and no ERC20 approval needed, nothing to do
  if (permitsNeeded.length === 0 && !needsToken0Approval && !needsToken1Approval) {
    return null;
  }

  // If ERC20 approval is needed but Permit2 allowance is valid, re-fetch nonces for permit data
  if (permitsNeeded.length === 0) {
    const permit2TokensForERC20Case = tokens.filter(t => !t.isNative && t.permitAmount > 0n);
    if (permit2TokensForERC20Case.length === 0) return null;

    const permit2NonceResults = await publicClient.multicall({
      contracts: permit2TokensForERC20Case.map(t => ({
        address: PERMIT2_ADDRESS as `0x${string}`,
        abi: iallowance_transfer_abi as any,
        functionName: 'allowance' as const,
        args: [getAddress(userAddress), t.address, positionManagerAddress] as const,
      })),
      allowFailure: false,
    });

    permit2TokensForERC20Case.forEach((t, i) => {
      const [, , permitNonce] = permit2NonceResults[i] as readonly [bigint, number, number];
      permitsNeeded.push({
        token: t.address,
        amount: t.permitAmount.toString(),
        expiration: toDeadline(PERMIT_EXPIRATION_MS).toString(),
        nonce: permitNonce.toString(),
      });
    });
  }

  const permit = {
    details: permitsNeeded,
    spender: positionManagerAddress,
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

  return {
    permitBatchData: {
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
    },
    signatureDetails: {
      domain: {
        name: domain.name || 'Permit2',
        chainId: Number(domain.chainId || chainId),
        verifyingContract: (domain.verifyingContract || PERMIT2_ADDRESS) as Hex,
      },
      types,
      primaryType: 'PermitBatch' as const,
    },
  };
}

// ---------------------------------------------------------------------------
// 3. buildPermitBatchForSDK
// ---------------------------------------------------------------------------

export function buildPermitBatchForSDK(
  permitBatchValues: {
    details: Array<{ token: string; amount: string; expiration: string; nonce: string }>;
    spender: string;
    sigDeadline: string;
  },
): AllowanceTransferPermitBatch {
  return {
    details: permitBatchValues.details.map((detail: any) => ({
      token: getAddress(detail.token),
      amount: String(detail.amount),
      expiration: String(detail.expiration),
      nonce: String(detail.nonce),
    })),
    spender: getAddress(permitBatchValues.spender),
    sigDeadline: String(permitBatchValues.sigDeadline),
  };
}
