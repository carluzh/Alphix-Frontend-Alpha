import { useState, useCallback, useEffect } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { toast } from 'sonner';
import { V4PositionPlanner } from '@uniswap/v4-sdk';
import { Token, ChainId } from '@uniswap/sdk-core'; // Import ChainId
import { V4_POSITION_MANAGER_ADDRESS, EMPTY_BYTES, V4_POSITION_MANAGER_ABI } from '@/lib/swap-constants';
import { getToken, TokenSymbol } from '@/lib/pools-config';
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
  const { address: accountAddress, chainId, connection } = useAccount();
  const { data: hash, writeContract, isPending: isDecreaseSendPending, error: decreaseSendError, reset: resetWriteContract } = useWriteContract();
  const { isLoading: isDecreaseConfirming, isSuccess: isDecreaseConfirmed, error: decreaseConfirmError, status: waitForTxStatus } = useWaitForTransactionReceipt({ hash });

  // Log full useAccount details for debugging
  useEffect(() => {
    console.log("useAccount details in useDecreaseLiquidity:", {
      accountAddress,
      chainId,
      connection,
      connector: connection?.connector, // Access connector if connection exists
      connectorChainId: connection?.connector?.chainId, // Try to get chainId from connector
      connectorGetChainId: typeof connection?.connector?.getChainId === 'function' ? 'function exists' : 'function missing',
    });
  }, [accountAddress, chainId, connection]);

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

  const decreaseLiquidity = useCallback(async (positionData: DecreasePositionData, decreasePercentage: number) => {
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

    try {
      const isPercentage = decreasePercentage > 0 && decreasePercentage <= 100;
      
      const token0Def = getToken(positionData.token0Symbol);
      const token1Def = getToken(positionData.token1Symbol);

      if (!token0Def || !token1Def) {
        throw new Error("Token definitions not found for one or both tokens in the position.");
      }
      if (!token0Def.address || !token1Def.address) {
        throw new Error("Token addresses are missing in definitions.");
      }

      // Revert to original chainId usage, rely on wagmi's type for Token constructor
      const sdkToken0 = new Token(chainId, getAddress(token0Def.address), token0Def.decimals, token0Def.symbol); 
      const sdkToken1 = new Token(chainId, getAddress(token1Def.address), token1Def.decimals, token1Def.symbol); 

      const planner = new V4PositionPlanner();
      
      // Get the actual NFT token ID with timeout
      const nftTokenId = await Promise.race([
        getTokenIdFromPosition(positionData),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Failed to resolve token ID. Please try again.')), 10000)
        )
      ]);
      
      const tokenIdJSBI = JSBI.BigInt(nftTokenId.toString());

      if (positionData.isFullBurn) {
        // If full burn, use addBurn (same as existing burn functionality)
        const amount0MinJSBI = JSBI.BigInt(0);
        const amount1MinJSBI = JSBI.BigInt(0);
        planner.addBurn(tokenIdJSBI, amount0MinJSBI, amount1MinJSBI, EMPTY_BYTES || '0x');
      } else {
        // If partial decrease, we need to get the current position info to calculate percentage
        let liquidityJSBI: JSBI;
        
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

          const currentPosition = positionsData.find((pos: any) => 
            pos.positionId === positionData.tokenId.toString()
          );
          
          if (currentPosition && currentPosition.liquidity) {
            const currentLiquidityJSBI = JSBI.BigInt(currentPosition.liquidity);
            
            // Calculate percentage to decrease based on token amounts
            const currentAmount0 = parseFloat(currentPosition.token0.amount);
            const currentAmount1 = parseFloat(currentPosition.token1.amount);
            const decreaseAmount0Num = parseFloat(positionData.decreaseAmount0 || "0");
            const decreaseAmount1Num = parseFloat(positionData.decreaseAmount1 || "0");
            
            // Calculate percentage based on the primary token being decreased
            let decreasePercentage = 0;
            
            if (decreaseAmount0Num > 0 && currentAmount0 > 0) {
              decreasePercentage = Math.max(decreasePercentage, decreaseAmount0Num / currentAmount0);
            }
            if (decreaseAmount1Num > 0 && currentAmount1 > 0) {
              decreasePercentage = Math.max(decreasePercentage, decreaseAmount1Num / currentAmount1);
            }
            
            // Ensure percentage is between 0 and 1, cap at 99% for safety
            decreasePercentage = Math.min(Math.max(decreasePercentage, 0), 0.99);
            
            // Calculate liquidity to remove based on percentage
            const liquidityToRemove = JSBI.multiply(
              currentLiquidityJSBI, 
              JSBI.BigInt(Math.floor(decreasePercentage * 10000))
            );
            liquidityJSBI = JSBI.divide(liquidityToRemove, JSBI.BigInt(10000));
            
            console.log("Calculated decrease liquidity:", {
              currentLiquidity: currentPosition.liquidity,
              decreasePercentage: (decreasePercentage * 100).toFixed(2) + '%',
              liquidityToRemove: liquidityJSBI.toString(),
              decreaseAmount0: decreaseAmount0Num,
              decreaseAmount1: decreaseAmount1Num,
              currentAmount0,
              currentAmount1
            });
            
          } else {
            console.error("get-positions API: current position not found or liquidity is missing for tokenId:", positionData.tokenId, "Data:", positionsData);
            throw new Error("Could not find current position data or liquidity");
          }
        } catch (error) {
          console.error("Error fetching current position for decrease:", error); // Changed from warn to error
          
          // Fallback: use a conservative estimate based on the amounts
          const amount0Raw = parseUnits(positionData.decreaseAmount0 || "0", token0Def.decimals);
          const amount1Raw = parseUnits(positionData.decreaseAmount1 || "0", token1Def.decimals);
          const maxAmountRaw = amount0Raw > amount1Raw ? amount0Raw : amount1Raw;
          
          // Use a conservative liquidity estimate
          liquidityJSBI = JSBI.divide(JSBI.BigInt(maxAmountRaw.toString()), JSBI.BigInt(1000));
          
          // Ensure minimum liquidity
          if (JSBI.lessThanOrEqual(liquidityJSBI, JSBI.BigInt(0))) {
            liquidityJSBI = JSBI.BigInt(100000);
          }
        }
        
        const amount0MinJSBI = JSBI.BigInt(0); // Minimum amounts for slippage protection
        const amount1MinJSBI = JSBI.BigInt(0);
        
        planner.addDecrease(tokenIdJSBI, liquidityJSBI, amount0MinJSBI, amount1MinJSBI, EMPTY_BYTES || '0x');
      }
      
      // Check if we're dealing with native ETH
      const hasNativeETH = token0Def.address === "0x0000000000000000000000000000000000000000" || 
                          token1Def.address === "0x0000000000000000000000000000000000000000";
      
      // Take the tokens back to the user's wallet
      planner.addTakePair(sdkToken0.wrapped, sdkToken1.wrapped, accountAddress);
      
      // For native ETH positions, we need to add a SWEEP to collect any native ETH
      if (hasNativeETH && token0Def.address === "0x0000000000000000000000000000000000000000") {
        // Token0 is ETH - need to sweep native ETH to user
        planner.addSweep(sdkToken0.wrapped, accountAddress);
      } else if (hasNativeETH && token1Def.address === "0x0000000000000000000000000000000000000000") {
        // Token1 is ETH - need to sweep native ETH to user  
        planner.addSweep(sdkToken1.wrapped, accountAddress);
      }

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
        isFullBurn: positionData.isFullBurn,
        hasNativeETH
      });
      
      writeContract({
        address: V4_POSITION_MANAGER_ADDRESS as Hex,
        abi: V4_POSITION_MANAGER_ABI,
        functionName: 'modifyLiquidities',
        args: [unlockData as Hex, deadline],
        chainId: chainId,
      });
    } catch (error: any) {
      console.error(`Error preparing ${actionName} transaction:`, error);
      const errorMessage = error.message || `Could not prepare the ${actionName} transaction.`;
      toast.error(`${actionName.charAt(0).toUpperCase() + actionName.slice(1)} Preparation Failed`, { 
        description: errorMessage 
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