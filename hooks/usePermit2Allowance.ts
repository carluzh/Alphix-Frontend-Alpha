"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { type Address, type Hex } from 'viem';
import { AVERAGE_L2_BLOCK_TIME_MS } from '@/lib/swap-constants';
import { Token } from '@/components/swap/swap-interface';

// Permit signature structure matching Uniswap's implementation
export interface PermitSignature {
  details: {
    token: Address;
    amount: string;
    expiration: number;
    nonce: number;
  };
  spender: Address;
  sigDeadline: string;
  signature: Hex;
}

// Allowance state enum for clear state management
export enum AllowanceState {
  LOADING = 'LOADING',
  REQUIRED = 'REQUIRED',
  ALLOWED = 'ALLOWED',
}

// Return type for the hook
export interface Permit2AllowanceResult {
  state: AllowanceState;
  permitSignature?: PermitSignature;
  isApproved: boolean;
  isPermitted: boolean;
  isSigned: boolean;
  needsSetupApproval: boolean;
  needsPermitSignature: boolean;

  // Methods
  approveToken: () => Promise<void>;
  signPermit: () => Promise<Hex | undefined>;
  refetch: () => Promise<void>;
}

interface UsePermit2AllowanceParams {
  token: Token | null;
  amount: string;
  accountAddress: Address | undefined;
  chainId: number;
  spender: Address;
  onApproveToken: (token: Token) => Promise<void>;
  onSignPermit: () => Promise<Hex | undefined>;
}

export function usePermit2Allowance({
  token,
  amount,
  accountAddress,
  chainId,
  spender,
  onApproveToken,
  onSignPermit,
}: UsePermit2AllowanceParams): Permit2AllowanceResult {

  // State for tracking permit data from API
  const [permitData, setPermitData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Local signature cache
  const [localSignature, setLocalSignature] = useState<PermitSignature | undefined>(undefined);

  // Time with block buffer - updates every block interval like Uniswap
  const [now, setNow] = useState(() => Math.floor((Date.now() + AVERAGE_L2_BLOCK_TIME_MS) / 1000));

  // Update time every block interval to handle expiration properly
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Math.floor((Date.now() + AVERAGE_L2_BLOCK_TIME_MS) / 1000));
    }, AVERAGE_L2_BLOCK_TIME_MS);

    return () => clearInterval(interval);
  }, []);

  // Check if token is approved to Permit2
  const isApproved = useMemo(() => {
    // This would need to be fetched from the approval check
    // For now, we'll handle this in the parent component
    return permitData?.isApproved ?? false;
  }, [permitData]);

  // Check if on-chain permit is valid
  const isPermitted = useMemo(() => {
    if (!permitData?.existingPermit || !amount) {
      return false;
    }

    const { amount: permitAmount, expiration } = permitData.existingPermit;
    const requiredAmount = BigInt(amount);
    const currentAmount = BigInt(permitAmount);

    // Use >= for both checks (Uniswap standard)
    return currentAmount >= requiredAmount && expiration >= now;
  }, [permitData, amount, now]);

  // Check if local signature is valid
  const isSigned = useMemo(() => {
    if (!localSignature || !amount || !token) {
      return false;
    }

    const sigDeadline = BigInt(localSignature.sigDeadline);

    // Validate signature matches current token and spender, and is not expired
    return (
      localSignature.details.token.toLowerCase() === token.address.toLowerCase() &&
      localSignature.spender.toLowerCase() === spender.toLowerCase() &&
      sigDeadline >= BigInt(now)
    );
  }, [localSignature, amount, token, spender, now]);

  // Determine if we need approval or signature
  const shouldRequestApproval = !isApproved;
  const shouldRequestSignature = !(isPermitted || isSigned);

  // Fetch permit data from API
  const fetchPermitData = useCallback(async () => {
    if (!token || !accountAddress || !amount || token.symbol === 'ETH') {
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/swap/prepare-permit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAddress: accountAddress,
          fromTokenAddress: token.address,
          fromTokenSymbol: token.symbol,
          chainId,
          amountIn: amount,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to fetch permit data');
      }

      setPermitData(data);
    } catch (error) {
      console.error('[usePermit2Allowance] Error fetching permit data:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [token, accountAddress, amount, chainId]);

  // Wrapper for approve with refetch
  const approveToken = useCallback(async () => {
    if (!token) return;

    await onApproveToken(token);
    // Refetch permit data after approval
    await new Promise(resolve => setTimeout(resolve, 1000));
    await fetchPermitData();
  }, [token, onApproveToken, fetchPermitData]);

  // Wrapper for sign with signature caching
  const signPermit = useCallback(async () => {
    const signature = await onSignPermit();

    if (signature && permitData?.permitData) {
      // Cache the signature locally
      const cachedSignature: PermitSignature = {
        details: {
          token: permitData.permitData.message.details.token,
          amount: permitData.permitData.message.details.amount,
          expiration: permitData.permitData.message.details.expiration,
          nonce: permitData.permitData.message.details.nonce,
        },
        spender: permitData.permitData.message.spender,
        sigDeadline: permitData.permitData.message.sigDeadline,
        signature,
      };

      setLocalSignature(cachedSignature);
    }

    return signature;
  }, [onSignPermit, permitData]);

  // Initial fetch on mount or when dependencies change
  useEffect(() => {
    if (token && accountAddress && amount && token.symbol !== 'ETH') {
      fetchPermitData();
    }
  }, [token?.address, accountAddress, amount, chainId]);

  // Return hook result based on state
  return useMemo(() => {
    // Native ETH doesn't need permits
    if (token?.symbol === 'ETH') {
      return {
        state: AllowanceState.ALLOWED,
        isApproved: true,
        isPermitted: true,
        isSigned: true,
        needsSetupApproval: false,
        needsPermitSignature: false,
        approveToken,
        signPermit,
        refetch: fetchPermitData,
      };
    }

    // Loading state
    if (isLoading || !permitData) {
      return {
        state: AllowanceState.LOADING,
        isApproved: false,
        isPermitted: false,
        isSigned: false,
        needsSetupApproval: false,
        needsPermitSignature: false,
        approveToken,
        signPermit,
        refetch: fetchPermitData,
      };
    }

    // Need approval or signature
    if (shouldRequestApproval || shouldRequestSignature) {
      return {
        state: AllowanceState.REQUIRED,
        isApproved,
        isPermitted,
        isSigned,
        needsSetupApproval: shouldRequestApproval,
        needsPermitSignature: shouldRequestSignature,
        approveToken,
        signPermit,
        refetch: fetchPermitData,
      };
    }

    // All good - return signature if we have a local one that's not yet on-chain
    return {
      state: AllowanceState.ALLOWED,
      permitSignature: !isPermitted && isSigned ? localSignature : undefined,
      isApproved: true,
      isPermitted: isPermitted || isSigned,
      isSigned,
      needsSetupApproval: false,
      needsPermitSignature: false,
      approveToken,
      signPermit,
      refetch: fetchPermitData,
    };
  }, [
    token,
    isLoading,
    permitData,
    shouldRequestApproval,
    shouldRequestSignature,
    isApproved,
    isPermitted,
    isSigned,
    localSignature,
    approveToken,
    signPermit,
    fetchPermitData,
  ]);
}
