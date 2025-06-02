import { useState, useCallback, useEffect } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { toast } from 'sonner';
import { V4PositionPlanner } from '@uniswap/v4-sdk';
import { Token } from '@uniswap/sdk-core';
import { TOKEN_DEFINITIONS, TokenSymbol, V4_POSITION_MANAGER_ADDRESS, EMPTY_BYTES, V4_POSITION_MANAGER_ABI } from '@/lib/swap-constants';
import { baseSepolia } from '@/lib/wagmiConfig';
import { getAddress, type Hex, BaseError, parseUnits } from 'viem';
import JSBI from 'jsbi';

interface UseDecreaseLiquidityProps {
  onLiquidityDecreased: () => void;
}

export interface DecreasePositionData {
  tokenId: string | number;
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
  decreaseAmount0: string; // Amount to remove
  decreaseAmount1: string; // Amount to remove
  isFullBurn: boolean; // Whether this is a full position burn
  // Position parameters needed to query the NFT token ID
  poolId: string;
  tickLower: number;
  tickUpper: number;
  salt?: string;
}

export function useDecreaseLiquidity({ onLiquidityDecreased }: UseDecreaseLiquidityProps) {
  const { address: accountAddress, chainId } = useAccount();
  const { data: hash, writeContract, isPending: isDecreaseSendPending, error: decreaseSendError, reset: resetWriteContract } = useWriteContract();
  const { isLoading: isDecreaseConfirming, isSuccess: isDecreaseConfirmed, error: decreaseConfirmError, status: waitForTxStatus } = useWaitForTransactionReceipt({ hash });

  const [isDecreasing, setIsDecreasing] = useState(false);

  // Helper function to get the NFT token ID from position parameters
  const getTokenIdFromPosition = useCallback(async (positionData: DecreasePositionData): Promise<bigint> => {
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

  const decreaseLiquidity = useCallback(async (positionData: DecreasePositionData) => {
    if (!accountAddress || !chainId) {
      toast.error("Wallet not connected. Please connect your wallet and try again.");
      return;
    }
    if (!V4_POSITION_MANAGER_ADDRESS) {
      toast.error("Configuration Error: Position Manager address not set.");
      return;
    }

    setIsDecreasing(true);
    const actionName = positionData.isFullBurn ? "burn" : "decrease";
    const toastId = toast.loading(`Preparing ${actionName} transaction...`);

    try {
      const token0Def = TOKEN_DEFINITIONS[positionData.token0Symbol];
      const token1Def = TOKEN_DEFINITIONS[positionData.token1Symbol];

      if (!token0Def || !token1Def) {
        throw new Error("Token definitions not found for one or both tokens in the position.");
      }
      if (!token0Def.addressRaw || !token1Def.addressRaw) {
        throw new Error("Token addresses are missing in definitions.");
      }

      const sdkToken0 = new Token(chainId, getAddress(token0Def.addressRaw), token0Def.decimals, token0Def.symbol);
      const sdkToken1 = new Token(chainId, getAddress(token1Def.addressRaw), token1Def.decimals, token1Def.symbol);

      const planner = new V4PositionPlanner();
      
      // Get the actual NFT token ID
      const nftTokenId = await getTokenIdFromPosition(positionData);
      const tokenIdJSBI = JSBI.BigInt(nftTokenId.toString());

      if (positionData.isFullBurn) {
        // If full burn, use addBurn (same as existing burn functionality)
        const amount0MinJSBI = JSBI.BigInt(0);
        const amount1MinJSBI = JSBI.BigInt(0);
        planner.addBurn(tokenIdJSBI, amount0MinJSBI, amount1MinJSBI, EMPTY_BYTES || '0x');
      } else {
        // If partial decrease, calculate the liquidity to remove based on which token is being removed
        let liquidityJSBI: JSBI;
        let inputAmount: string;
        let inputTokenSymbol: string;
        
        // Determine which token is being removed (for out-of-range positions, one will be 0)
        if (parseFloat(positionData.decreaseAmount0) > 0 && parseFloat(positionData.decreaseAmount1) > 0) {
          // Both tokens - use token0 for calculation
          inputAmount = positionData.decreaseAmount0;
          inputTokenSymbol = positionData.token0Symbol;
        } else if (parseFloat(positionData.decreaseAmount0) > 0) {
          // Only token0
          inputAmount = positionData.decreaseAmount0;
          inputTokenSymbol = positionData.token0Symbol;
        } else if (parseFloat(positionData.decreaseAmount1) > 0) {
          // Only token1
          inputAmount = positionData.decreaseAmount1;
          inputTokenSymbol = positionData.token1Symbol;
        } else {
          throw new Error("No valid token amounts provided for decrease");
        }
        
        try {
          const calcResponse = await fetch('/api/liquidity/calculate-liquidity-parameters', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token0Symbol: positionData.token0Symbol,
              token1Symbol: positionData.token1Symbol,
              inputAmount: inputAmount,
              inputTokenSymbol: inputTokenSymbol,
              userTickLower: positionData.tickLower,
              userTickUpper: positionData.tickUpper,
              chainId: chainId,
            }),
          });

          if (calcResponse.ok) {
            const result = await calcResponse.json();
            liquidityJSBI = JSBI.BigInt(result.liquidity);
            console.log("Calculated liquidity for decrease:", result.liquidity, "from", inputAmount, inputTokenSymbol);
          } else {
            console.warn("Failed to calculate liquidity for decrease, using estimated value");
            // For fallback, use a more reasonable estimate based on the actual input amount
            const inputAmountRaw = parseUnits(inputAmount, inputTokenSymbol === positionData.token0Symbol ? token0Def.decimals : token1Def.decimals);
            const inputAmountJSBI = JSBI.BigInt(inputAmountRaw.toString());
            const estimatedLiquidity = JSBI.divide(inputAmountJSBI, JSBI.BigInt(1000)); // Simple estimation
            liquidityJSBI = JSBI.greaterThan(estimatedLiquidity, JSBI.BigInt(0)) ? estimatedLiquidity : JSBI.BigInt(500000);
          }
        } catch (error) {
          console.warn("Error calculating liquidity for decrease, using fallback:", error);
          // For fallback, use a more reasonable estimate
          const inputAmountRaw = parseUnits(inputAmount, inputTokenSymbol === positionData.token0Symbol ? token0Def.decimals : token1Def.decimals);
          const inputAmountJSBI = JSBI.BigInt(inputAmountRaw.toString());
          const estimatedLiquidity = JSBI.divide(inputAmountJSBI, JSBI.BigInt(1000)); // Simple estimation
          liquidityJSBI = JSBI.greaterThan(estimatedLiquidity, JSBI.BigInt(0)) ? estimatedLiquidity : JSBI.BigInt(500000);
        }
        
        const amount0MinJSBI = JSBI.BigInt(0); // Minimum amounts for slippage protection
        const amount1MinJSBI = JSBI.BigInt(0);
        
        planner.addDecrease(tokenIdJSBI, liquidityJSBI, amount0MinJSBI, amount1MinJSBI, EMPTY_BYTES || '0x');
      }
      
      // Take the tokens back to the user's wallet
      planner.addTakePair(sdkToken0.wrapped, sdkToken1.wrapped, accountAddress);

      resetWriteContract(); 
      
      // Calculate deadline (60 seconds from now)
      const deadline = Math.floor(Date.now() / 1000) + 60;
      
      // Encode actions and params into single bytes for modifyLiquidities
      const unlockData = planner.finalize();
      
      console.log(`${actionName} transaction debug:`, {
        unlockData,
        deadline,
        tokenId: nftTokenId.toString(),
        positionManager: V4_POSITION_MANAGER_ADDRESS,
        isFullBurn: positionData.isFullBurn
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
      console.error(`Error preparing ${actionName} transaction:`, error);
      toast.error(`${actionName.charAt(0).toUpperCase() + actionName.slice(1)} Preparation Failed`, { 
        id: toastId, 
        description: error.message || "Could not prepare the transaction." 
      });
      setIsDecreasing(false);
    }
  }, [accountAddress, chainId, writeContract, resetWriteContract, getTokenIdFromPosition]);

  useEffect(() => {
    if (isDecreaseSendPending) {
      // toast.loading is already shown by decreaseLiquidity
    } else if (decreaseSendError) {
      toast.dismiss();
      const message = decreaseSendError instanceof BaseError ? decreaseSendError.shortMessage : decreaseSendError.message;
      toast.error("Transaction Submission Failed", { description: message });
      setIsDecreasing(false);
    } else if (hash && waitForTxStatus === 'pending' && !isDecreaseConfirming) {
       toast.loading("Transaction submitted. Waiting for confirmation...", { id: hash });
    }
  }, [isDecreaseSendPending, decreaseSendError, hash, waitForTxStatus, isDecreaseConfirming]);

  useEffect(() => {
    if (!hash) return;

    if (isDecreaseConfirming) {
      toast.loading("Confirming transaction...", { id: hash });
    } else if (isDecreaseConfirmed) {
      toast.success("Liquidity Modified!", {
        id: hash,
        description: "Your position has been successfully modified.",
        action: baseSepolia?.blockExplorers?.default?.url 
          ? { label: "View Tx", onClick: () => window.open(`${baseSepolia.blockExplorers.default.url}/tx/${hash}`, '_blank') }
          : undefined,
      });
      onLiquidityDecreased();
      setIsDecreasing(false);
    } else if (decreaseConfirmError) {
       const message = decreaseConfirmError instanceof BaseError ? decreaseConfirmError.shortMessage : decreaseConfirmError.message;
      toast.error("Transaction Confirmation Failed", {
        id: hash,
        description: message,
        action: baseSepolia?.blockExplorers?.default?.url 
          ? { label: "View Tx", onClick: () => window.open(`${baseSepolia.blockExplorers.default.url}/tx/${hash}`, '_blank') }
          : undefined,
      });
      setIsDecreasing(false);
    }
  }, [isDecreaseConfirming, isDecreaseConfirmed, decreaseConfirmError, hash, onLiquidityDecreased, baseSepolia?.blockExplorers?.default?.url]);

  return {
    decreaseLiquidity,
    isLoading: isDecreasing || isDecreaseSendPending || isDecreaseConfirming,
    isSuccess: isDecreaseConfirmed,
    error: decreaseSendError || decreaseConfirmError,
    hash,
  };
} 