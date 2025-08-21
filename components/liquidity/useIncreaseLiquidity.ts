import { useState, useCallback, useEffect } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { toast } from 'sonner';
import { V4PositionPlanner } from '@uniswap/v4-sdk';
import { Token, ChainId } from '@uniswap/sdk-core'; // Import ChainId
import { V4_POSITION_MANAGER_ADDRESS, EMPTY_BYTES, V4_POSITION_MANAGER_ABI } from '@/lib/swap-constants';
import { getToken, TokenSymbol } from '@/lib/pools-config';
import { baseSepolia } from '@/lib/wagmiConfig';
import { getAddress, type Hex, BaseError, parseUnits } from 'viem';

// Helper function to safely parse amounts without precision loss
const safeParseUnits = (amount: string, decimals: number): bigint => {
  const cleaned = (amount || '').toString().replace(/,/g, '').trim();
  if (!cleaned || cleaned === '.' || cleaned === '< 0.0001') return 0n;
  return parseUnits(cleaned, decimals);
};
import JSBI from 'jsbi';

interface UseIncreaseLiquidityProps {
  onLiquidityIncreased: () => void;
}

export interface IncreasePositionData {
  tokenId: string | number;
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
  additionalAmount0: string; // New amount to add
  additionalAmount1: string; // New amount to add
  // Position parameters needed to query the NFT token ID
  poolId: string;
  tickLower: number;
  tickUpper: number;
  salt?: string;
}

export function useIncreaseLiquidity({ onLiquidityIncreased }: UseIncreaseLiquidityProps) {
  const { address: accountAddress, chainId, connection } = useAccount();
  const { data: hash, writeContract, isPending: isIncreaseSendPending, error: increaseSendError, reset: resetWriteContract } = useWriteContract();
  const { isLoading: isIncreaseConfirming, isSuccess: isIncreaseConfirmed, error: increaseConfirmError, status: waitForTxStatus } = useWaitForTransactionReceipt({ hash });

  // Log full useAccount details for debugging
  useEffect(() => {
    console.log("useAccount details in useIncreaseLiquidity:", {
      accountAddress,
      chainId,
      connection,
      connector: connection?.connector, // Access connector if connection exists
      connectorChainId: connection?.connector?.chainId, // Try to get chainId from connector
      connectorGetChainId: typeof connection?.connector?.getChainId === 'function' ? 'function exists' : 'function missing',
    });
  }, [accountAddress, chainId, connection]);

  const [isIncreasing, setIsIncreasing] = useState(false);

  // Helper function to get the NFT token ID from position parameters
  const getTokenIdFromPosition = useCallback(async (positionData: IncreasePositionData): Promise<bigint> => {
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

  const increaseLiquidity = useCallback(async (positionData: IncreasePositionData) => {
    if (!accountAddress || !chainId) {
      toast.error("Wallet not connected. Please connect your wallet and try again.");
      return;
    }
    if (!V4_POSITION_MANAGER_ADDRESS) {
      toast.error("Configuration Error: Position Manager address not set.");
      return;
    }

    setIsIncreasing(true);
    const toastId = toast.loading("Preparing increase transaction...");

    try {
      const token0Def = getToken(positionData.token0Symbol);
      const token1Def = getToken(positionData.token1Symbol);

      if (!token0Def || !token1Def) {
        throw new Error("Token definitions not found for one or both tokens in the position.");
      }
      if (!token0Def.address || !token1Def.address) {
        throw new Error("Token addresses are missing in definitions.");
      }

      // Initialize these variables at the top of the try block
      let amount0Raw = 0n; 
      let amount1Raw = 0n;
      let amount0MaxJSBI = JSBI.BigInt(0);
      let amount1MaxJSBI = JSBI.BigInt(0);

      // Revert to original chainId usage, rely on wagmi's type for Token constructor
      const sdkToken0 = new Token(chainId, getAddress(token0Def.address), token0Def.decimals, token0Def.symbol);
      const sdkToken1 = new Token(chainId, getAddress(token1Def.address), token1Def.decimals, token1Def.symbol);
      const [sortedSdkToken0, sortedSdkToken1] = sdkToken0.sortsBefore(sdkToken1)
        ? [sdkToken0, sdkToken1]
        : [sdkToken1, sdkToken0];

      const planner = new V4PositionPlanner();
      
      // Get the actual NFT token ID
      const nftTokenId = await getTokenIdFromPosition(positionData);
      const tokenIdJSBI = JSBI.BigInt(nftTokenId.toString());
      
      // Convert additional amounts to proper units using parseUnits, then to JSBI
      amount0Raw = safeParseUnits(positionData.additionalAmount0, token0Def.decimals);
      amount1Raw = safeParseUnits(positionData.additionalAmount1, token1Def.decimals);
      
      // Convert to JSBI BigInt
      amount0MaxJSBI = JSBI.BigInt(amount0Raw.toString());
      amount1MaxJSBI = JSBI.BigInt(amount1Raw.toString());

      // Map raw amounts to sorted token order for max constraints and native value handling
      const amountSorted0Raw = sdkToken0.address === sortedSdkToken0.address ? amount0Raw : amount1Raw;
      const amountSorted1Raw = sdkToken0.address === sortedSdkToken0.address ? amount1Raw : amount0Raw;
      const amountSorted0MaxJSBI = JSBI.BigInt(amountSorted0Raw.toString());
      const amountSorted1MaxJSBI = JSBI.BigInt(amountSorted1Raw.toString());
      
      // For liquidity calculation, we need to determine which token has a non-zero amount
      let liquidityJSBI: JSBI;
      let inputAmount: string;
      let inputTokenSymbol: string;
      
      // Determine which token is being added (for out-of-range positions, one will be 0)
      if (parseFloat(positionData.additionalAmount0) > 0 && parseFloat(positionData.additionalAmount1) > 0) {
        // Both tokens - use token0 for calculation
        inputAmount = positionData.additionalAmount0;
        inputTokenSymbol = positionData.token0Symbol;
      } else if (parseFloat(positionData.additionalAmount0) > 0) {
        // Only token0
        inputAmount = positionData.additionalAmount0;
        inputTokenSymbol = positionData.token0Symbol;
      } else if (parseFloat(positionData.additionalAmount1) > 0) {
        // Only token1
        inputAmount = positionData.additionalAmount1;
        inputTokenSymbol = positionData.token1Symbol;
      } else {
        throw new Error("No valid token amounts provided");
      }

      try {
        // Fetch current position data from get-positions API to get current liquidity
        console.log(`Fetching positions for owner ${accountAddress} from /api/liquidity/get-positions`);
        const positionsResponse = await fetch(`/api/liquidity/get-positions?ownerAddress=${accountAddress}`);
        
        if (!positionsResponse.ok) {
          console.error("get-positions API response not OK:", positionsResponse.status, positionsResponse.statusText);
          const errorBody = await positionsResponse.text();
          console.error("get-positions API error body:", errorBody);
          throw new Error(`Failed to fetch current position data: ${positionsResponse.statusText}. Details: ${errorBody.substring(0, 100)}...`);
        }
        const positionsData = await positionsResponse.json();
        console.log("get-positions API data received:", positionsData); // Log the received data

        console.log(`Searching for position with tokenId: ${positionData.tokenId.toString()}`);
        const currentPosition = positionsData.find((pos: any) => {
          console.log(`Comparing with API positionId: ${pos.positionId}`);
          return pos.positionId === positionData.tokenId.toString();
        });
        
        if (currentPosition && currentPosition.liquidity) {
          const currentLiquidityJSBI = JSBI.BigInt(currentPosition.liquidity);
          
          // For partial increase, calculate new liquidity
          // This is a placeholder; real calculation involves pool state, tick range, and token amounts
          // For now, we'll just use a simple sum or a more robust calculation if `calculate-liquidity-parameters` is available
          
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
            console.log("Calculated liquidity for increase:", result.liquidity, "from", inputAmount, inputTokenSymbol);
          } else {
            console.warn("Failed to calculate liquidity, using estimated value");
            // For fallback, use a more reasonable estimate based on the actual input amount
            const inputAmountRawLocal = inputTokenSymbol === positionData.token0Symbol ? amount0Raw : amount1Raw;
            const inputAmountJSBI = JSBI.BigInt(inputAmountRawLocal.toString());
            const estimatedLiquidity = JSBI.divide(inputAmountJSBI, JSBI.BigInt(1000)); // Simple estimation
            liquidityJSBI = JSBI.greaterThan(estimatedLiquidity, JSBI.BigInt(0)) ? estimatedLiquidity : JSBI.BigInt(1000000);
          }
        } else {
          console.error("get-positions API: current position not found or liquidity is missing for tokenId:", positionData.tokenId, "Data:", positionsData);
          throw new Error("Could not find current position data or liquidity");
        }
      } catch (error) {
        console.error("Error fetching current position for increase or calculating liquidity:", error); // Changed from warn to error
        
        // For fallback, use a more reasonable estimate
        const inputAmountRawLocal = inputTokenSymbol === positionData.token0Symbol ? amount0Raw : amount1Raw;
        const inputAmountJSBI = JSBI.BigInt(inputAmountRawLocal.toString());
        const estimatedLiquidity = JSBI.divide(inputAmountJSBI, JSBI.BigInt(1000)); // Simple estimation
        liquidityJSBI = JSBI.greaterThan(estimatedLiquidity, JSBI.BigInt(0)) ? estimatedLiquidity : JSBI.BigInt(1000000);
      }

      // Check if we're dealing with native ETH
      const hasNativeETH = token0Def.address === "0x0000000000000000000000000000000000000000" || 
                          token1Def.address === "0x0000000000000000000000000000000000000000";

      // First settle tokens from the user's wallet (send tokens to PM), then increase
      // Use sorted token order for settlement to match pool key ordering
      planner.addSettlePair(sortedSdkToken0.wrapped, sortedSdkToken1.wrapped);

      // Increase the position - this adds liquidity to existing position. Amount maxes must follow sorted order
      planner.addIncrease(tokenIdJSBI, liquidityJSBI, amountSorted0MaxJSBI, amountSorted1MaxJSBI, EMPTY_BYTES || '0x');

      resetWriteContract(); 
      
      // Calculate deadline (60 seconds from now)
      const deadline = Math.floor(Date.now() / 1000) + 60;
      
      // Encode actions and params into single bytes for modifyLiquidities
      const unlockData = planner.finalize();
      
      // Calculate the transaction value for native ETH
      let transactionValue = BigInt(0);
      if (hasNativeETH) {
        // Match native value to whichever sorted token is native
        if (getAddress(sortedSdkToken0.address) === '0x0000000000000000000000000000000000000000') {
          transactionValue = amountSorted0Raw;
        } else if (getAddress(sortedSdkToken1.address) === '0x0000000000000000000000000000000000000000') {
          transactionValue = amountSorted1Raw;
        }
      }
      
      console.log("Increase transaction debug:", {
        unlockData,
        deadline,
        tokenId: nftTokenId.toString(),
        positionManager: V4_POSITION_MANAGER_ADDRESS,
        hasNativeETH,
        transactionValue: transactionValue.toString()
      });
      
      writeContract({
        address: V4_POSITION_MANAGER_ADDRESS as Hex,
        abi: V4_POSITION_MANAGER_ABI,
        functionName: 'modifyLiquidities',
        args: [unlockData as Hex, deadline],
        value: transactionValue,
        chainId: chainId,
      });

      // Dismiss the preparation toast since transaction is now being submitted
      toast.dismiss(toastId);

    } catch (error: any) {
      console.error("Error preparing increase transaction:", error);
      toast.error("Increase Preparation Failed", { id: toastId, description: error.message || "Could not prepare the transaction." });
      setIsIncreasing(false);
    }
  }, [accountAddress, chainId, writeContract, resetWriteContract, getTokenIdFromPosition]);

  useEffect(() => {
    if (isIncreaseSendPending) {
      // toast.loading is already shown by increaseLiquidity
    } else if (increaseSendError) {
      toast.dismiss();
      const message = increaseSendError instanceof BaseError ? increaseSendError.shortMessage : increaseSendError.message;
      toast.error("Transaction Submission Failed", { description: message });
      setIsIncreasing(false);
    } else if (hash && waitForTxStatus === 'pending' && !isIncreaseConfirming) {
       toast.loading("Transaction submitted. Waiting for confirmation...", { id: hash });
    }
  }, [isIncreaseSendPending, increaseSendError, hash, waitForTxStatus, isIncreaseConfirming]);

  useEffect(() => {
    if (!hash) return;

    if (isIncreaseConfirming) {
      toast.loading("Confirming transaction...", { id: hash });
    } else if (isIncreaseConfirmed) {
      toast.success("Liquidity Increased!", {
        id: hash,
        description: "Your position has been successfully increased.",
        action: baseSepolia?.blockExplorers?.default?.url 
          ? { label: "View Tx", onClick: () => window.open(`${baseSepolia.blockExplorers.default.url}/tx/${hash}`, '_blank') }
          : undefined,
      });
      onLiquidityIncreased();
      setIsIncreasing(false);
    } else if (increaseConfirmError) {
       const message = increaseConfirmError instanceof BaseError ? increaseConfirmError.shortMessage : increaseConfirmError.message;
      toast.error("Increase Confirmation Failed", {
        id: hash,
        description: message,
        action: baseSepolia?.blockExplorers?.default?.url 
          ? { label: "View Tx", onClick: () => window.open(`${baseSepolia.blockExplorers.default.url}/tx/${hash}`, '_blank') }
          : undefined,
      });
      setIsIncreasing(false);
    }
  }, [isIncreaseConfirming, isIncreaseConfirmed, increaseConfirmError, hash, onLiquidityIncreased, baseSepolia?.blockExplorers?.default?.url]);

  return {
    increaseLiquidity,
    isLoading: isIncreasing || isIncreaseSendPending || isIncreaseConfirming,
    isSuccess: isIncreaseConfirmed,
    error: increaseSendError || increaseConfirmError,
    hash,
  };
} 