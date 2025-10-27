import { useMemo, useState, useEffect } from 'react';
import { useReadContract } from 'wagmi';
import { TokenSymbol, TOKEN_DEFINITIONS, NATIVE_TOKEN_ADDRESS, getPositionManagerAddress } from '@/lib/pools-config';
import { PERMIT2_ADDRESS } from '@/lib/swap-constants';
import { ERC20_ABI } from '@/lib/abis/erc20';
import { iallowance_transfer_abi } from '@/lib/abis/IAllowanceTransfer_abi';
import { parseUnits } from 'viem';

export interface CheckLiquidityApprovalsParams {
  userAddress?: string;
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
  amount0: string;
  amount1: string;
  chainId?: number;
  tickLower?: number;
  tickUpper?: number;
}

export interface CheckLiquidityApprovalsResponse {
  needsToken0ERC20Approval: boolean;
  needsToken1ERC20Approval: boolean;
  needsToken0Permit: boolean;
  needsToken1Permit: boolean;
  permitBatchData?: any;
  signatureDetails?: any;
}

export function useCheckLiquidityApprovals(
  params: CheckLiquidityApprovalsParams | undefined,
  options?: {
    enabled?: boolean;
    staleTime?: number;
    refetchInterval?: number | false;
  }
) {
  const token0Config = params ? TOKEN_DEFINITIONS[params.token0Symbol] : undefined;
  const token1Config = params ? TOKEN_DEFINITIONS[params.token1Symbol] : undefined;

  // Check if tokens are native (ETH) - native tokens don't need approval
  const isToken0Native = token0Config?.address === NATIVE_TOKEN_ADDRESS;
  const isToken1Native = token1Config?.address === NATIVE_TOKEN_ADDRESS;

  // Parse amounts for comparison
  const amount0Wei = useMemo(() => {
    if (!params?.amount0 || !token0Config) return 0n;
    try {
      return parseUnits(params.amount0, token0Config.decimals);
    } catch {
      return 0n;
    }
  }, [params?.amount0, token0Config]);

  const amount1Wei = useMemo(() => {
    if (!params?.amount1 || !token1Config) return 0n;
    try {
      return parseUnits(params.amount1, token1Config.decimals);
    } catch {
      return 0n;
    }
  }, [params?.amount1, token1Config]);

  // Check Token0 allowance (skip if native) - matches swap pattern
  const {
    data: token0Allowance,
    isLoading: isLoadingToken0,
    refetch: refetchToken0,
  } = useReadContract({
    address: token0Config?.address as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [params?.userAddress as `0x${string}`, PERMIT2_ADDRESS],
    query: {
      enabled: options?.enabled && !isToken0Native && Boolean(params?.userAddress && token0Config),
      staleTime: options?.staleTime ?? 1000, // 1 second for fast updates after approval
    },
  });

  // Check Token1 allowance (skip if native) - matches swap pattern
  const {
    data: token1Allowance,
    isLoading: isLoadingToken1,
    refetch: refetchToken1,
  } = useReadContract({
    address: token1Config?.address as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [params?.userAddress as `0x${string}`, PERMIT2_ADDRESS],
    query: {
      enabled: options?.enabled && !isToken1Native && Boolean(params?.userAddress && token1Config),
      staleTime: options?.staleTime ?? 1000, // 1 second for fast updates after approval
    },
  });

  const POSITION_MANAGER = getPositionManagerAddress();

  const needsToken0ERC20Approval = !isToken0Native &&
    amount0Wei > 0n &&
    (token0Allowance === undefined || (token0Allowance as bigint) < amount0Wei);

  const needsToken1ERC20Approval = !isToken1Native &&
    amount1Wei > 0n &&
    (token1Allowance === undefined || (token1Allowance as bigint) < amount1Wei);

  const {
    data: token0PermitData,
    isLoading: isLoadingToken0Permit,
    refetch: refetchToken0Permit,
  } = useReadContract({
    address: PERMIT2_ADDRESS as `0x${string}`,
    abi: iallowance_transfer_abi,
    functionName: 'allowance',
    args: [
      params?.userAddress as `0x${string}`,
      token0Config?.address as `0x${string}`,
      POSITION_MANAGER as `0x${string}`
    ],
    query: {
      enabled: options?.enabled && !isToken0Native && !needsToken0ERC20Approval && Boolean(params?.userAddress && token0Config),
      staleTime: options?.staleTime ?? 1000,
    },
  });

  const {
    data: token1PermitData,
    isLoading: isLoadingToken1Permit,
    refetch: refetchToken1Permit,
  } = useReadContract({
    address: PERMIT2_ADDRESS as `0x${string}`,
    abi: iallowance_transfer_abi,
    functionName: 'allowance',
    args: [
      params?.userAddress as `0x${string}`,
      token1Config?.address as `0x${string}`,
      POSITION_MANAGER as `0x${string}`
    ],
    query: {
      enabled: options?.enabled && !isToken1Native && !needsToken1ERC20Approval && Boolean(params?.userAddress && token1Config),
      staleTime: options?.staleTime ?? 1000,
    },
  });

  const now = Math.floor(Date.now() / 1000);

  const needsToken0Permit = !isToken0Native && !needsToken0ERC20Approval && amount0Wei > 0n && (() => {
    if (!token0PermitData) return false;
    const [amount, expiration] = token0PermitData as readonly [bigint, number, bigint];
    const hasValidPermit = amount > amount0Wei && expiration > now;
    return !hasValidPermit;
  })();

  const needsToken1Permit = !isToken1Native && !needsToken1ERC20Approval && amount1Wei > 0n && (() => {
    if (!token1PermitData) return false;
    const [amount, expiration] = token1PermitData as readonly [bigint, number, bigint];
    const hasValidPermit = amount > amount1Wei && expiration > now;
    return !hasValidPermit;
  })();

  const [permitData, setPermitData] = useState<{ permitBatchData?: any; signatureDetails?: any }>({});

  // Clear permitData when pool/tokens change
  useEffect(() => {
    console.log('[POOL CHANGE] Clearing permitData');
    setPermitData({});
  }, [params?.token0Symbol, params?.token1Symbol, params?.userAddress]);

  // Track permitData changes
  useEffect(() => {
    console.log('[STATE] permitData changed, hasData:', !!permitData.permitBatchData);
  }, [permitData]);

  useEffect(() => {
    const willFetch = (needsToken0Permit || needsToken1Permit) && !needsToken0ERC20Approval && !needsToken1ERC20Approval && !!params?.userAddress;
    console.log('[EFFECT] triggered, willFetch:', willFetch, { needsToken0Permit, needsToken1Permit });

    if ((needsToken0Permit || needsToken1Permit) && !needsToken0ERC20Approval && !needsToken1ERC20Approval && params?.userAddress) {
      fetch('/api/liquidity/prepare-mint-tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAddress: params.userAddress,
          token0Symbol: params.token0Symbol,
          token1Symbol: params.token1Symbol,
          inputAmount: params.amount0,
          inputTokenSymbol: params.token0Symbol,
          userTickLower: params.tickLower || 0,
          userTickUpper: params.tickUpper || 0,
          chainId: params.chainId,
        }),
      })
        .then(res => res.ok ? res.json() : null)
        .then(result => {
          if (result?.needsApproval && result.approvalType === 'PERMIT2_BATCH_SIGNATURE') {
            const newPermitData = { permitBatchData: result.permitBatchData, signatureDetails: result.signatureDetails };
            console.log('[API] Setting permitData');
            setPermitData(newPermitData);
          }
        })
        .catch((err) => {
          console.error('[API] Error:', err);
        });
    }
  }, [needsToken0Permit, needsToken1Permit, needsToken0ERC20Approval, needsToken1ERC20Approval, params?.userAddress, params?.token0Symbol, params?.token1Symbol, params?.amount0, params?.amount1, params?.tickLower, params?.tickUpper, params?.chainId]);

  const data = useMemo((): CheckLiquidityApprovalsResponse => {
    console.log('[MEMO] Building data, hasPermitBatchData:', !!permitData.permitBatchData);
    return {
      needsToken0ERC20Approval,
      needsToken1ERC20Approval,
      needsToken0Permit,
      needsToken1Permit,
      ...permitData,
    };
  }, [needsToken0ERC20Approval, needsToken1ERC20Approval, needsToken0Permit, needsToken1Permit, permitData]);

  return {
    data,
    isLoading: isLoadingToken0 || isLoadingToken1 || isLoadingToken0Permit || isLoadingToken1Permit,
    refetch: async () => {
      await Promise.all([refetchToken0(), refetchToken1(), refetchToken0Permit(), refetchToken1Permit()]);
      // Don't clear permitData here - it's needed for the deposit transaction
    },
  };
}
