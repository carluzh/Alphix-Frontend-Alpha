import { useMemo, useState, useEffect } from 'react';
import { useReadContract } from 'wagmi';
import { TokenSymbol, getTokenDefinitions, NATIVE_TOKEN_ADDRESS } from '@/lib/pools-config';
import { useNetwork } from '@/lib/network-context';
import { PERMIT2_ADDRESS } from '@/lib/swap-constants';
import { ERC20_ABI } from '@/lib/abis/erc20';
import { parseUnits } from 'viem';

export interface CheckZapApprovalsParams {
  userAddress?: string;
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
  inputTokenSymbol: 'token0' | 'token1';  // Which token is the input
  inputAmount: string;
  chainId?: number;
  tickLower?: number;
  tickUpper?: number;
  slippageToleranceBps?: number; // Slippage in basis points (e.g., 50 = 0.5%)
}

export interface CheckZapApprovalsResponse {
  needsInputTokenERC20Approval: boolean;
  needsOutputTokenERC20Approval: boolean;
  inputTokenAddress?: string;
  outputTokenAddress?: string;
  inputTokenSymbol?: TokenSymbol;
  outputTokenSymbol?: TokenSymbol;
  swapPermitData?: {
    token: string;
    amount: string;
    nonce: number;
    expiration: number;
    sigDeadline: string;
    spender: string;
  };
  batchPermitData?: any;
  signatureDetails?: any;
}

export function useCheckZapApprovals(
  params: CheckZapApprovalsParams | undefined,
  options?: {
    enabled?: boolean;
    staleTime?: number;
    refetchInterval?: number | false;
  }
) {
  const { networkMode } = useNetwork();
  const tokenDefinitions = useMemo(() => getTokenDefinitions(networkMode), [networkMode]);

  const inputTokenConfig = params
    ? tokenDefinitions[params.inputTokenSymbol === 'token0' ? params.token0Symbol : params.token1Symbol]
    : undefined;

  const outputTokenConfig = params
    ? tokenDefinitions[params.inputTokenSymbol === 'token0' ? params.token1Symbol : params.token0Symbol]
    : undefined;

  // Check if tokens are native (ETH) - native tokens don't need approval
  const isInputTokenNative = inputTokenConfig?.address === NATIVE_TOKEN_ADDRESS;
  const isOutputTokenNative = outputTokenConfig?.address === NATIVE_TOKEN_ADDRESS;

  // Parse input amount for comparison
  const inputAmountWei = useMemo(() => {
    if (!params?.inputAmount || !inputTokenConfig) return 0n;
    try {
      return parseUnits(params.inputAmount, inputTokenConfig.decimals);
    } catch {
      return 0n;
    }
  }, [params?.inputAmount, inputTokenConfig]);

  // Check input token allowance to Permit2 (skip if native)
  const {
    data: inputTokenAllowance,
    isLoading: isLoadingInputToken,
    refetch: refetchInputToken,
  } = useReadContract({
    address: inputTokenConfig?.address as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [params?.userAddress as `0x${string}`, PERMIT2_ADDRESS],
    query: {
      enabled: options?.enabled && !isInputTokenNative && Boolean(params?.userAddress && inputTokenConfig),
      staleTime: options?.staleTime ?? 1000, // 1 second for fast updates after approval
      gcTime: 0, // Don't cache - always fetch fresh data when refetching
    },
  });

  // Check output token allowance to Permit2 (skip if native)
  const {
    data: outputTokenAllowance,
    isLoading: isLoadingOutputToken,
    refetch: refetchOutputToken,
  } = useReadContract({
    address: outputTokenConfig?.address as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [params?.userAddress as `0x${string}`, PERMIT2_ADDRESS],
    query: {
      enabled: options?.enabled && !isOutputTokenNative && Boolean(params?.userAddress && outputTokenConfig),
      staleTime: options?.staleTime ?? 1000,
      gcTime: 0,
    },
  });

  const needsInputTokenERC20Approval = !isInputTokenNative &&
    inputAmountWei > 0n &&
    Boolean(params?.userAddress) &&
    (inputTokenAllowance === undefined || (inputTokenAllowance as bigint) < inputAmountWei);

  // Output token needs approval if it's not native and doesn't have sufficient approval
  // We use a reasonable threshold (1M tokens) since we don't know exact deposit amount until after swap
  // This matches the pattern used in regular liquidity flow
  const outputTokenQueryEnabled = !isOutputTokenNative && Boolean(params?.userAddress && outputTokenConfig);
  const outputTokenThresholdWei = useMemo(() => {
    if (!outputTokenConfig) return 0n;
    try {
      return parseUnits("1000000", outputTokenConfig.decimals);
    } catch {
      return 0n;
    }
  }, [outputTokenConfig]);
  
  const needsOutputTokenERC20Approval = !isOutputTokenNative &&
    params?.userAddress !== undefined &&
    outputTokenConfig !== undefined &&
    outputTokenQueryEnabled &&
    (outputTokenAllowance === undefined || (outputTokenAllowance as bigint) < outputTokenThresholdWei);

  const [permitData, setPermitData] = useState<{
    swapPermitData?: any;
    batchPermitData?: any;
    signatureDetails?: any;
  }>({});
  const [isLoadingPermitData, setIsLoadingPermitData] = useState(false);

  // Reset permit data when params change
  useEffect(() => {
    setPermitData({});
    setIsLoadingPermitData(false);
  }, [params?.token0Symbol, params?.token1Symbol, params?.userAddress]);

  // Fetch permit data from API when needed
  useEffect(() => {
    // Always fetch permit data if we have valid params, regardless of approval status
    if (params?.userAddress && inputAmountWei > 0n) {
      setIsLoadingPermitData(true);

      fetch('/api/liquidity/prepare-zap-mint-tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAddress: params.userAddress,
          token0Symbol: params.token0Symbol,
          token1Symbol: params.token1Symbol,
          inputAmount: params.inputAmount,
          inputTokenSymbol: params.inputTokenSymbol === 'token0' ? params.token0Symbol : params.token1Symbol,
          userTickLower: params.tickLower || 0,
          userTickUpper: params.tickUpper || 0,
          chainId: params.chainId,
          slippageTolerance: params.slippageToleranceBps ?? 50,
        }),
      })
        .then(res => {
          if (!res.ok) {
            return null;
          }
          return res.json();
        })
        .then(result => {
          if (!result) {
            setIsLoadingPermitData(false);
            return;
          }

          if (result?.needsApproval) {
            // The API returns permitData for the swap
            if (result.approvalType === 'PERMIT2_SIGNATURE' && result.permitData) {
              setPermitData(prev => ({
                ...prev,
                swapPermitData: result.permitData
              }));
            }
          }

          setIsLoadingPermitData(false);
        })
        .catch(err => {
          setIsLoadingPermitData(false);
        });
    }
  }, [
    needsInputTokenERC20Approval,
    params?.userAddress,
    params?.token0Symbol,
    params?.token1Symbol,
    params?.inputAmount,
    params?.inputTokenSymbol,
    params?.tickLower,
    params?.tickUpper,
    params?.chainId,
    params?.slippageToleranceBps,
    inputAmountWei,
  ]);

  const data = useMemo((): CheckZapApprovalsResponse => ({
    needsInputTokenERC20Approval,
    needsOutputTokenERC20Approval,
    inputTokenAddress: inputTokenConfig?.address,
    outputTokenAddress: outputTokenConfig?.address,
    inputTokenSymbol: params?.inputTokenSymbol === 'token0' ? params.token0Symbol : params?.token1Symbol,
    outputTokenSymbol: params?.inputTokenSymbol === 'token0' ? params.token1Symbol : params?.token0Symbol,
    ...permitData,
  }), [needsInputTokenERC20Approval, needsOutputTokenERC20Approval, inputTokenConfig, outputTokenConfig, params, permitData]);


  return {
    data,
    isLoading: isLoadingInputToken || isLoadingOutputToken || isLoadingPermitData,
    refetch: async () => {
      await refetchInputToken();
      await refetchOutputToken();
    },
  };
}
