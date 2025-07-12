import { useState, useCallback, useEffect } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi';
import { toast } from 'sonner';
import { V4PositionPlanner } from '@uniswap/v4-sdk';
import { Token } from '@uniswap/sdk-core';
import { V4_POSITION_MANAGER_ADDRESS, EMPTY_BYTES, V4_POSITION_MANAGER_ABI } from '@/lib/swap-constants';
import { getToken, TokenSymbol } from '@/lib/pools-config';
import { baseSepolia } from '@/lib/wagmiConfig';
import { getAddress, type Hex, BaseError } from 'viem';
import JSBI from 'jsbi';

interface UseBurnLiquidityProps {
  onLiquidityBurned: () => void;
}

export interface BurnPositionData {
  tokenId: string | number;
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
  // Position parameters needed to query the NFT token ID
  poolId: string;
  tickLower: number;
  tickUpper: number;
  salt?: string;
}

export function useBurnLiquidity({ onLiquidityBurned }: UseBurnLiquidityProps) {
  const { address: accountAddress, chainId } = useAccount();
  const { data: hash, writeContract, isPending: isBurnSendPending, error: burnSendError, reset: resetWriteContract } = useWriteContract();
  const { isLoading: isBurnConfirming, isSuccess: isBurnConfirmed, error: burnConfirmError, status: waitForTxStatus } = useWaitForTransactionReceipt({ hash });

  const [isBurning, setIsBurning] = useState(false);
  const [positionToQuery, setPositionToQuery] = useState<BurnPositionData | null>(null);

  // Helper function to get the NFT token ID from position parameters
  const getTokenIdFromPosition = useCallback(async (positionData: BurnPositionData): Promise<bigint> => {
    // For now, we'll use a simple approach: parse the salt from the composite ID
    // In a production app, you should query the Position Manager contract
    const compositeId = positionData.tokenId.toString();
    const parts = compositeId.split('-');
    
    // The last part should be the salt/token ID
    const saltHex = parts[parts.length - 1];
    
    if (saltHex && saltHex !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
      try {
        // Convert hex to BigInt
        const tokenId = BigInt(saltHex);
        if (tokenId > 0n) {
          return tokenId;
        }
      } catch (e) {
        console.warn('Failed to parse token ID from salt:', saltHex);
      }
    }
    
    // Fallback: try to extract token ID from the composite ID
    // This is a temporary solution - in production you should query the contract
    throw new Error('Unable to determine NFT token ID from position data. Please contact support.');
  }, []);

  const burnLiquidity = useCallback(async (positionData: BurnPositionData) => {
    if (!accountAddress || !chainId) {
      toast.error("Wallet not connected. Please connect your wallet and try again.");
      return;
    }
    if (!V4_POSITION_MANAGER_ADDRESS) {
      toast.error("Configuration Error: Position Manager address not set.");
      return;
    }

    setIsBurning(true);
    const toastId = toast.loading("Preparing burn transaction...");

    try {
      const token0Def = getToken(positionData.token0Symbol);
      const token1Def = getToken(positionData.token1Symbol);

      if (!token0Def || !token1Def) {
        throw new Error("Token definitions not found for one or both tokens in the position.");
      }
      if (!token0Def.address || !token1Def.address) {
        throw new Error("Token addresses are missing in definitions.");
      }

      const sdkToken0 = new Token(chainId, getAddress(token0Def.address), token0Def.decimals, token0Def.symbol);
      const sdkToken1 = new Token(chainId, getAddress(token1Def.address), token1Def.decimals, token1Def.symbol);

      const planner = new V4PositionPlanner();
      
      // Get the actual NFT token ID
      const nftTokenId = await getTokenIdFromPosition(positionData);
      const tokenIdJSBI = JSBI.BigInt(nftTokenId.toString());
      const amount0MinJSBI = JSBI.BigInt(0);
      const amount1MinJSBI = JSBI.BigInt(0);

      // Burn the position - this removes liquidity and collects fees
      planner.addBurn(tokenIdJSBI, amount0MinJSBI, amount1MinJSBI, EMPTY_BYTES || '0x');
      
      // Take the tokens back to the user's wallet
      planner.addTakePair(sdkToken0.wrapped, sdkToken1.wrapped, accountAddress);

      resetWriteContract(); 
      
      // Calculate deadline (60 seconds from now)
      const deadline = Math.floor(Date.now() / 1000) + 60;
      
      // Encode actions and params into single bytes for modifyLiquidities
      const unlockData = planner.finalize();
      
      console.log("Burn transaction debug:", {
        unlockData,
        deadline,
        tokenId: nftTokenId.toString(),
        positionManager: V4_POSITION_MANAGER_ADDRESS
      });
      
      writeContract({
        address: V4_POSITION_MANAGER_ADDRESS as Hex,
        abi: V4_POSITION_MANAGER_ABI,
        functionName: 'modifyLiquidities',
        args: [unlockData as Hex, deadline],
        chainId: chainId,
      });

      // Dismiss the preparation toast since transaction is now being submitted
      toast.dismiss(toastId);

    } catch (error: any) {
      console.error("Error preparing burn transaction:", error);
      toast.error("Burn Preparation Failed", { id: toastId, description: error.message || "Could not prepare the transaction." });
      setIsBurning(false);
    }
  }, [accountAddress, chainId, writeContract, resetWriteContract, getTokenIdFromPosition]);

  useEffect(() => {
    if (isBurnSendPending) {
      // toast.loading is already shown by burnLiquidity
    } else if (burnSendError) {
      toast.dismiss();
      const message = burnSendError instanceof BaseError ? burnSendError.shortMessage : burnSendError.message;
      toast.error("Transaction Submission Failed", { description: message });
      setIsBurning(false);
    } else if (hash && waitForTxStatus === 'pending' && !isBurnConfirming) {
       toast.loading("Transaction submitted. Waiting for confirmation...", { id: hash });
    }
  }, [isBurnSendPending, burnSendError, hash, waitForTxStatus, isBurnConfirming]);

  useEffect(() => {
    if (!hash) return;

    if (isBurnConfirming) {
      toast.loading("Confirming transaction...", { id: hash });
    } else if (isBurnConfirmed) {
      toast.success("Liquidity Burned!", {
        id: hash,
        description: "Your position has been successfully removed.",
        action: baseSepolia?.blockExplorers?.default?.url 
          ? { label: "View Tx", onClick: () => window.open(`${baseSepolia.blockExplorers.default.url}/tx/${hash}`, '_blank') }
          : undefined,
      });
      onLiquidityBurned();
      setIsBurning(false);
    } else if (burnConfirmError) {
       const message = burnConfirmError instanceof BaseError ? burnConfirmError.shortMessage : burnConfirmError.message;
      toast.error("Burn Confirmation Failed", {
        id: hash,
        description: message,
        action: baseSepolia?.blockExplorers?.default?.url 
          ? { label: "View Tx", onClick: () => window.open(`${baseSepolia.blockExplorers.default.url}/tx/${hash}`, '_blank') }
          : undefined,
      });
      setIsBurning(false);
    }
  }, [isBurnConfirming, isBurnConfirmed, burnConfirmError, hash, onLiquidityBurned, baseSepolia?.blockExplorers?.default?.url]);

  return {
    burnLiquidity,
    isLoading: isBurning || isBurnSendPending || isBurnConfirming,
    isSuccess: isBurnConfirmed,
    error: burnSendError || burnConfirmError,
    hash,
  };
} 