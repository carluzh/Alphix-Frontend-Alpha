import {
  type Address,
  type Hex,
  parseUnits,
  getAddress,
} from "viem";

// Helper function to safely parse amounts and prevent scientific notation errors
const safeParseUnits = (amount: string, decimals: number): bigint => {
  // Convert scientific notation to decimal format
  const numericAmount = parseFloat(amount);
  if (isNaN(numericAmount)) {
    throw new Error("Invalid number format");
  }
  
  // Convert to string with full decimal representation (no scientific notation)
  const fullDecimalString = numericAmount.toFixed(decimals);
  
  // Remove trailing zeros after decimal point
  const trimmedString = fullDecimalString.replace(/\.?0+$/, '');
  
  // If the result is just a decimal point, return "0"
  const finalString = trimmedString === '.' ? '0' : trimmedString;
  
  return parseUnits(finalString, decimals);
};
import {
  TOKEN_DEFINITIONS,
  TokenSymbol,
  getPoolByTokens,
  getToken,
} from "./pools-config";
import { findBestRoute, SwapRoute } from "./routing-engine";
import { config, baseSepolia } from "./wagmiConfig";
import { getPublicClient } from "@wagmi/core";
import {
  PERMIT2_ADDRESS,
  UNIVERSAL_ROUTER_ADDRESS,
  Erc20AbiDefinition,
  UniversalRouterAbi,
} from "./swap-constants";
import {
  writeContract,
  waitForTransactionReceipt,
} from "@wagmi/core";

const TARGET_CHAIN_ID = baseSepolia.id;

export interface SwapQuote {
  toAmount: string;
  route: SwapRoute;
  // Potentially add fees, price impact etc.
}

export interface TxExecution {
  status: "success" | "error";
  txHash?: Hex;
  error?: string;
}

/**
 * Gets a swap quote.
 * @param fromTokenSymbol - The symbol of the token to sell.
 * @param toTokenSymbol - The symbol of the token to buy.
 * @param amount - The amount to sell, in human-readable format (e.g., "1.23").
 * @returns A promise that resolves to a SwapQuote.
 */
export async function getQuote(
  fromTokenSymbol: TokenSymbol,
  toTokenSymbol: TokenSymbol,
  amount: string
): Promise<SwapQuote> {
  const response = await fetch('/api/swap/get-quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fromTokenSymbol,
      toTokenSymbol,
      amountDecimalsStr: amount,
      chainId: TARGET_CHAIN_ID,
    }),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Failed to get quote');
  }

  return {
    toAmount: data.toAmount,
    route: data.route,
  };
}

/**
 * Checks if the user needs to approve the fromToken for spending by Permit2.
 * @param userAddress - The user's wallet address.
 * @param fromTokenSymbol - The symbol of the token to check.
 * @param amount - The amount that will be swapped.
 * @returns A promise that resolves to true if approval is needed.
 */
export async function needsApproval(
  userAddress: Address,
  fromTokenSymbol: TokenSymbol,
  amount: string
): Promise<boolean> {
  const fromToken = getToken(fromTokenSymbol);
  if (!fromToken) {
    throw new Error(`Token not found: ${fromTokenSymbol}`);
  }

  const publicClient = getPublicClient(config, { chainId: TARGET_CHAIN_ID });
  if (!publicClient) {
    throw new Error("Public client not found for checking approval.");
  }

  const parsedAmount = safeParseUnits(amount, fromToken.decimals);

  const allowance = await publicClient.readContract({
    address: fromToken.address as Address,
    abi: Erc20AbiDefinition,
    functionName: 'allowance',
    args: [userAddress, PERMIT2_ADDRESS as Address]
  }) as bigint;

  return allowance < parsedAmount;
}

/**
 * Checks if the user needs to sign a Permit2 message.
 * This should be called after checking for ERC20 approval.
 * @param userAddress - The user's wallet address.
 * @param fromTokenSymbol - The symbol of the token to check.
 * @returns A promise that resolves to the data needed for signing, or null if no signature is needed.
 */
export async function needsPermitSignature(
  userAddress: Address,
  fromTokenSymbol: TokenSymbol,
): Promise<any | null> {
  const fromToken = getToken(fromTokenSymbol);
  if (!fromToken) {
    throw new Error(`Token not found: ${fromTokenSymbol}`);
  }
  
  const response = await fetch('/api/swap/prepare-permit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userAddress: userAddress,
      tokenAddress: fromToken.address,
      chainId: TARGET_CHAIN_ID,
      checkExisting: true,
    }),
  });
  
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch permit data');
  }

  // Using the same constant as in the swap interface for consistency
  const MaxUint160 = BigInt('0xffffffffffffffffffffffffffffffffffffffff');

  const needsSignature = !data.hasValidPermit || BigInt(data.currentPermitInfo.amount) < MaxUint160;

  if (needsSignature) {
    return data;
  }
  
  return null;
}


/**
 * Builds and executes the swap transaction.
 * This is the final step in the swap process.
 *
 * @param userAddress - The user's wallet address.
 * @param fromTokenSymbol - The symbol of the token to sell.
 * @param toTokenSymbol - The symbol of the token to buy.
 * @param amount - The amount to sell.
 * @param permitData - The data needed for Permit2 approval.
 * @param permitSignature - The signature from `signPermit`, if one was required.
 * @returns A promise that resolves to a TxExecution object.
 */
export async function executeSwap(
  userAddress: Address,
  fromTokenSymbol: TokenSymbol,
  toTokenSymbol: TokenSymbol,
  amount: string,
  permitData: any,
  permitSignature?: Hex
): Promise<TxExecution> {
  try {
    const fromToken = getToken(fromTokenSymbol);
    const toToken = getToken(toTokenSymbol);
    if (!fromToken || !toToken) {
      throw new Error("Invalid token symbols provided.");
    }

    // 1. Get route
    const routeResult = findBestRoute(fromToken.symbol, toToken.symbol);
    if (!routeResult.bestRoute) {
      throw new Error(`No route found for token pair: ${fromToken.symbol} → ${toToken.symbol}`);
    }
    const route = routeResult.bestRoute;

    // 2. Fetch dynamic fee (matching the working frontend approach)
    let fetchedDynamicFee: number | null = null;
    try {
        if (route.isDirectRoute) {
            // Single hop - fetch fee for the direct pool
            const feeResponse = await fetch('/api/swap/get-dynamic-fee', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fromTokenSymbol: fromToken.symbol,
                    toTokenSymbol: toToken.symbol,
                    chainId: TARGET_CHAIN_ID,
                }),
            });
            const feeData = await feeResponse.json();
            if (!feeResponse.ok) {
                throw new Error(feeData.message || feeData.errorDetails || 'Failed to fetch dynamic fee');
            }
            fetchedDynamicFee = Number(feeData.dynamicFee);
            if (isNaN(fetchedDynamicFee)) {
                throw new Error('Dynamic fee received is not a number: ' + feeData.dynamicFee);
            }
        } else {
            // Multi-hop: For now use default fee (could be enhanced to fetch for each hop)
            fetchedDynamicFee = 3000; // 0.30% default fee
        }
    } catch (feeError: any) {
        console.error("[executeSwap] Error fetching dynamic fee:", feeError);
        throw new Error("Failed to fetch dynamic fee: " + (feeError.message || feeError));
    }

    // 3. Call /api/swap/build-tx
    const MaxUint160 = BigInt('0xffffffffffffffffffffffffffffffffffffffff');
    const effectiveTimestamp = BigInt(Math.floor(Date.now() / 1000));
    const effectiveFallbackSigDeadline = effectiveTimestamp + BigInt(30 * 60); // 30 min fallback

    const bodyForSwapTx = {
         userAddress,
         fromTokenSymbol: fromToken.symbol,
         toTokenSymbol: toToken.symbol,
         swapType: 'ExactIn',
         amountDecimalsStr: amount,
         limitAmountDecimalsStr: "0", // API calculates this
         permitSignature: permitSignature || "0x", 
         permitTokenAddress: fromToken.address,
         permitAmount: MaxUint160.toString(),
         permitNonce: permitData.nonce, // Use actual permit data from API
         permitExpiration: permitData.permitExpiration, // Use actual permit data from API
         permitSigDeadline: permitData.sigDeadline ? permitData.sigDeadline.toString() : effectiveFallbackSigDeadline.toString(),
         chainId: TARGET_CHAIN_ID,
         dynamicSwapFee: fetchedDynamicFee, // Pass the fetched fee
    };

    const buildTxResponse = await fetch('/api/swap/build-tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyForSwapTx),
    });
    const buildTxData = await buildTxResponse.json();

    if (!buildTxResponse.ok) {
         const errorInfo = buildTxData.message || 'Failed to build transaction';
         const cause = buildTxData.errorDetails || buildTxData.error;
         throw new Error(errorInfo, { cause: cause });
    }

    // 4. Send transaction with wagmi
    const txHash = await writeContract(config, {
        address: getAddress(buildTxData.to),
        abi: UniversalRouterAbi,
        functionName: 'execute',
        args: [buildTxData.commands as Hex, buildTxData.inputs as Hex[], BigInt(buildTxData.deadline)],
        value: BigInt(buildTxData.value),
        chainId: TARGET_CHAIN_ID,
    });

    const receipt = await waitForTransactionReceipt(config, {
      hash: txHash,
      chainId: TARGET_CHAIN_ID,
    });

    if (receipt.status !== 'success') {
      throw new Error("Swap transaction failed on-chain");
    }

    return {
      status: "success",
      txHash: txHash,
    };

  } catch (error: any) {
    console.error("[executeSwap] Error:", error);
    return {
      status: "error",
      error: error.message,
    };
  }
} 