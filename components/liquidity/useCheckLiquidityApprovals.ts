// Hook for checking liquidity approval status (Uniswap-style)
import { useQuery } from '@tanstack/react-query';
import { TokenSymbol } from '@/lib/pools-config';

export interface CheckLiquidityApprovalsParams {
  userAddress?: string;
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
  amount0: string;
  amount1: string;
  chainId?: number;
}

export interface CheckLiquidityApprovalsResponse {
  needsToken0ERC20Approval: boolean;
  needsToken1ERC20Approval: boolean;
  needsToken0Permit: boolean;
  needsToken1Permit: boolean;
  // Approval transaction data (if needed)
  token0ApprovalData?: {
    tokenAddress: string;
    tokenSymbol: TokenSymbol;
    approveToAddress: string;
    approvalAmount: string;
  };
  token1ApprovalData?: {
    tokenAddress: string;
    tokenSymbol: TokenSymbol;
    approveToAddress: string;
    approvalAmount: string;
  };
  // Permit signature data (if needed)
  permitBatchData?: {
    details: Array<{
      token: string;
      amount: string;
      expiration: string;
      nonce: string;
    }>;
    spender: string;
    sigDeadline: string;
  };
  signatureDetails?: {
    domain: {
      name: string;
      chainId: number;
      verifyingContract: string;
      version?: string;
    };
    types: any;
    primaryType: string;
  };
}

async function fetchApprovalStatus(
  params: CheckLiquidityApprovalsParams
): Promise<CheckLiquidityApprovalsResponse> {
  const response = await fetch('/api/liquidity/check-approvals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || 'Failed to check approvals');
  }

  return response.json();
}

export function useCheckLiquidityApprovals(
  params: CheckLiquidityApprovalsParams | undefined,
  options?: {
    enabled?: boolean;
    staleTime?: number;
    refetchInterval?: number | false;
  }
) {
  return useQuery({
    queryKey: ['checkLiquidityApprovals', params],
    queryFn: () => {
      if (!params) {
        throw new Error('Params required');
      }
      return fetchApprovalStatus(params);
    },
    enabled: options?.enabled ?? Boolean(params?.userAddress && params?.chainId),
    staleTime: options?.staleTime ?? 5000, // 5 seconds
    refetchInterval: options?.refetchInterval ?? false,
    retry: false,
  });
}
