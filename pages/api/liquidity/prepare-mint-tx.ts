import { Token, Percent, Ether } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position, V4PositionManager } from "@uniswap/v4-sdk"; 
import type { MintOptions } from "@uniswap/v4-sdk";
import { nearestUsableTick } from '@uniswap/v3-sdk';
import JSBI from 'jsbi';
import type { NextApiRequest, NextApiResponse } from 'next';

import { STATE_VIEW_ABI as STATE_VIEW_HUMAN_READABLE_ABI } from "@/lib/abis/state_view_abi"; 
import { TokenSymbol, getToken, getPositionManagerAddress, getStateViewAddress } from "../../../lib/pools-config";
import { iallowance_transfer_abi } from "../../../lib/abis/IAllowanceTransfer_abi"; // For Permit2 allowance method

import { publicClient } from "../../../lib/viemClient"; 
import { 
    isAddress, 
    getAddress, 
    parseAbi, 
    maxUint256,
    parseUnits,
    type Hex 
} from "viem";


// Constants for Permit2
import {
    PERMIT_TYPES,
    PERMIT2_DOMAIN_NAME,
    PERMIT_EXPIRATION_DURATION_SECONDS, 
    PERMIT_SIG_DEADLINE_DURATION_SECONDS, 
} from "../../../lib/swap-constants";

const POSITION_MANAGER_ADDRESS = getPositionManagerAddress();
const PERMIT2_ADDRESS = getAddress("0x000000000022D473030F116dDEE9F6B43aC78BA3"); // Permit2 contract address
const STATE_VIEW_ADDRESS = getStateViewAddress();
const ETHERS_ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";
const SDK_MIN_TICK = -887272;
const SDK_MAX_TICK = 887272;

interface PrepareMintTxRequest extends NextApiRequest {
    body: {
        userAddress: string;
        token0Symbol: TokenSymbol; 
        token1Symbol: TokenSymbol;
        inputAmount: string;      
        inputTokenSymbol: TokenSymbol; 
        userTickLower: number;
        userTickUpper: number;
        chainId: number;
        // Optional parameter to indicate which token was just processed
        tokenJustProcessed?: TokenSymbol;
        // Optional permit signature data for when permits are provided
        permitSignature?: string;
        permitSingleData?: {
            details: {
                token: string;
                amount: string;
                expiration: number;
                nonce: number;
            };
            spender: string;
            sigDeadline: string;
        };
        // Optional batch permit data for new batch permit flow
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
    };
}

// Define MAX_UINT_160 for Permit2 amounts (used for 'infinite' approval from Permit2's perspective)
const MAX_UINT_160 = (1n << 160n) - 1n;

// Structure for EIP-712 PermitSingle message (values will be strings for API, client parses to bigint)
type PermitSingleMessageForAPI = {
    details: {
        token: Hex;
        amount: string; // string representation of uint160
        expiration: number; // uint48
        nonce: number; // uint48
    };
    spender: Hex;
    sigDeadline: string; // string representation of uint256
};

// Updated ApprovalNeededResponse to handle both ERC20 and Permit2 signature steps
interface ApprovalNeededResponse {
    needsApproval: true;
    approvalTokenAddress: string; 
    approvalTokenSymbol: TokenSymbol;
    approvalType: 'ERC20_TO_PERMIT2' | 'PERMIT2_SIGNATURE_FOR_PM';

    // For ERC20_TO_PERMIT2
    approveToAddress?: string; // Will be PERMIT2_ADDRESS
    approvalAmount?: string; // Will be maxUint256.toString()

    // For PERMIT2_SIGNATURE_FOR_PM
    signatureDetails?: {
        domain: {
            name: string;
            version?: string; // Optional version for EIP-712 domain
            chainId: number;
            verifyingContract: Hex; // PERMIT2_ADDRESS
        };
        types: typeof PERMIT_TYPES; // The actual type definitions for EIP-712
        primaryType: 'PermitSingle';
        message: PermitSingleMessageForAPI; 
    };
    permit2Address?: Hex; // PERMIT2_ADDRESS, for client to call .permit() on
}


interface TransactionPreparedResponse {
    needsApproval: false;
    transaction: {
        to: string;
        data: string; 
        value: string; 
    };
    deadline: string; 
    details: {
        token0: { address: string; symbol: TokenSymbol; amount: string; }; 
        token1: { address: string; symbol: TokenSymbol; amount: string; }; 
        liquidity: string;
        finalTickLower: number;
        finalTickUpper: number;
    };
}

type PrepareMintTxResponse = ApprovalNeededResponse | TransactionPreparedResponse | { message: string; error?: any };

export default async function handler(
    req: PrepareMintTxRequest,
    res: NextApiResponse<PrepareMintTxResponse>
) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
    }

    const stateViewAbiViem = parseAbi(STATE_VIEW_HUMAN_READABLE_ABI);

    try {
        const {
            userAddress,
            token0Symbol,
            token1Symbol,
            inputAmount,
            inputTokenSymbol,
            userTickLower,
            userTickUpper,
            chainId,
            tokenJustProcessed,
            permitSignature,
            permitSingleData
        } = req.body;

        if (!isAddress(userAddress)) {
            return res.status(400).json({ message: "Invalid userAddress." });
        }
        
        const token0Config = getToken(token0Symbol);
        const token1Config = getToken(token1Symbol);
        const inputTokenConfig = getToken(inputTokenSymbol);

        if (!token0Config || !token1Config || !inputTokenConfig) {
            return res.status(400).json({ message: "Invalid token symbol(s) provided." });
        }
        if (isNaN(parseFloat(inputAmount)) || parseFloat(inputAmount) <= 0) {
            return res.status(400).json({ message: "Invalid inputAmount." });
        }
        if (typeof userTickLower !== 'number' || typeof userTickUpper !== 'number') {
            return res.status(400).json({ message: "userTickLower and userTickUpper must be numbers." });
        }

        const sdkToken0 = new Token(chainId, getAddress(token0Config.address), token0Config.decimals, token0Config.symbol);
        const sdkToken1 = new Token(chainId, getAddress(token1Config.address), token1Config.decimals, token1Config.symbol);
        const sdkInputToken = inputTokenSymbol === token0Symbol ? sdkToken0 : sdkToken1;

        const normalizeAmountString = (raw: string): string => {
            let s = (raw ?? '').toString().trim().replace(/,/g, '.');
            if (!/e|E/.test(s)) return s;
            // Expand scientific notation without using floats
            const match = s.match(/^([+-]?)(\d*\.?\d+)[eE]([+-]?\d+)$/);
            if (!match) return s; // fallback
            const sign = match[1] || '';
            const num = match[2];
            const exp = parseInt(match[3], 10);
            const parts = num.split('.');
            const intPart = parts[0] || '0';
            const fracPart = parts[1] || '';
            const digits = (intPart + fracPart).replace(/^0+/, '') || '0';
            let pointIndex = intPart.length;
            let newPoint = pointIndex + exp;
            if (exp >= 0) {
                if (newPoint >= digits.length) {
                    const zeros = '0'.repeat(newPoint - digits.length);
                    return sign + digits + zeros;
                } else {
                    return sign + digits.slice(0, newPoint) + '.' + digits.slice(newPoint);
                }
            } else {
                if (newPoint <= 0) {
                    const zeros = '0'.repeat(-newPoint);
                    return sign + '0.' + zeros + digits;
                } else {
                    return sign + digits.slice(0, newPoint) + '.' + digits.slice(newPoint);
                }
            }
        };

        const normalizedInput = normalizeAmountString(inputAmount);
        const parsedInputAmount_BigInt = parseUnits(normalizedInput, sdkInputToken.decimals); 
        const parsedInputAmount_JSBI = JSBI.BigInt(parsedInputAmount_BigInt.toString()); 

        // Use configured pool ID from pools.json instead of deriving
        const { getPoolByTokens } = await import('../../../lib/pools-config');
        const poolConfig = getPoolByTokens(token0Symbol, token1Symbol);
        
        if (!poolConfig) {
            return res.status(400).json({ message: `No pool configuration found for ${token0Symbol}/${token1Symbol}` });
        }

        const clampedUserTickLower = Math.max(userTickLower, SDK_MIN_TICK);
        const clampedUserTickUpper = Math.min(userTickUpper, SDK_MAX_TICK);
        let tickLower = nearestUsableTick(clampedUserTickLower, poolConfig.tickSpacing);
        let tickUpper = nearestUsableTick(clampedUserTickUpper, poolConfig.tickSpacing);
        if (tickLower >= tickUpper) {
            tickLower = tickUpper - poolConfig.tickSpacing;
        }

        // After alignment, the previous clamp adjusts ordering. No further error required here.
        
        const [sortedToken0, sortedToken1] = sdkToken0.sortsBefore(sdkToken1) 
            ? [sdkToken0, sdkToken1] 
            : [sdkToken1, sdkToken0];

        const poolId = V4Pool.getPoolId(
            sortedToken0,
            sortedToken1,
            poolConfig.fee,
            poolConfig.tickSpacing,
            getAddress(poolConfig.hooks) as `0x${string}`
        );
        
        // sortedToken0/1 determined above

        // Query current pool state

        let currentSqrtPriceX96_JSBI: JSBI;
        let currentTick: number;
        let currentLiquidity: bigint;

        try {
            const [slot0, liquidity] = await Promise.all([
                publicClient.readContract({
                    address: STATE_VIEW_ADDRESS,
                    abi: stateViewAbiViem,
                    functionName: 'getSlot0',
                    args: [poolId as Hex]
                }) as Promise<readonly [bigint, number, number, number]>,
                publicClient.readContract({
                    address: STATE_VIEW_ADDRESS,
                    abi: stateViewAbiViem,
                    functionName: 'getLiquidity',
                    args: [poolId as Hex]
                }) as Promise<bigint>
            ]);

            const sqrtPriceX96Current = slot0[0] as bigint;
            currentTick = slot0[1] as number;
            currentLiquidity = liquidity as bigint;
            currentSqrtPriceX96_JSBI = JSBI.BigInt(sqrtPriceX96Current.toString());

            // Check if pool is initialized
            if (sqrtPriceX96Current === 0n) {
                return res.status(400).json({ 
                    message: `Pool ${token0Symbol}/${token1Symbol} (${poolId}) is not initialized. sqrtPriceX96 = 0. This is likely why you're getting PoolNotInitialized errors.` 
                });
            }

        } catch (error) {
            console.error("API Error (prepare-mint-tx) fetching pool slot0 data:", error);
            return res.status(500).json({ message: "Failed to fetch current pool data.", error });
        }

        // Use NativeCurrency for the native leg to satisfy SDK native handling
        const poolCurrency0 = sortedToken0.address === ETHERS_ADDRESS_ZERO ? Ether.onChain(Number(chainId)) : sortedToken0;
        const poolCurrency1 = sortedToken1.address === ETHERS_ADDRESS_ZERO ? Ether.onChain(Number(chainId)) : sortedToken1;

        const v4PoolForCalc = new V4Pool(
            poolCurrency0 as any,
            poolCurrency1 as any,
            poolConfig.fee, // Use fee from pool configuration 
            poolConfig.tickSpacing, // Use tick spacing from pool configuration
            poolConfig.hooks as `0x${string}`, // Use hook address from pool configuration
            currentSqrtPriceX96_JSBI, 
            JSBI.BigInt(currentLiquidity.toString()), 
            currentTick
        );

        let position: V4Position;
        if (sdkInputToken.address === sortedToken0.address) {
            position = V4Position.fromAmount0({
                pool: v4PoolForCalc,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0: parsedInputAmount_JSBI, 
                useFullPrecision: true
            });
        } else { 
            position = V4Position.fromAmount1({
                pool: v4PoolForCalc,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount1: parsedInputAmount_JSBI
            });
        }
        
        const liquidity = position.liquidity;
        const amount0 = BigInt(position.mintAmounts.amount0.toString());
        const amount1 = BigInt(position.mintAmounts.amount1.toString());

        const MAX_UINT_128 = (1n << 128n) - 1n;
        if (JSBI.GT(liquidity, JSBI.BigInt(MAX_UINT_128.toString()))) {
            return res.status(400).json({
                message: "The selected price range is too narrow for the provided input amount, resulting in an impractically large liquidity value."
            });
        }
        

        if (amount0 <= 0n && amount1 <= 0n && JSBI.GT(liquidity, JSBI.BigInt(0))) {
            return res.status(400).json({ message: "Calculation resulted in zero amounts for both tokens but positive liquidity. This is an unlikely scenario, please check inputs." });
        }
        if (amount0 <= 0n && amount1 <= 0n && JSBI.LE(liquidity, JSBI.BigInt(0))) { 
            return res.status(400).json({ message: "Calculation resulted in zero amounts and zero liquidity. Please provide a valid input amount and range." });
        }

        const tokensToCheck = [
            { sdkToken: sortedToken0, requiredAmount: amount0, symbol: getToken(sortedToken0.symbol as TokenSymbol)?.symbol || sortedToken0.symbol || "Token0" },
            { sdkToken: sortedToken1, requiredAmount: amount1, symbol: getToken(sortedToken1.symbol as TokenSymbol)?.symbol || sortedToken1.symbol || "Token1" }
        ];

        // Debug calculated amounts
        console.log(`[DEBUG] Calculated amounts for ${token0Symbol}/${token1Symbol}:`);
        console.log(`[DEBUG] ${tokensToCheck[0].symbol}: ${tokensToCheck[0].requiredAmount} (${Number(tokensToCheck[0].requiredAmount) / Math.pow(10, tokensToCheck[0].sdkToken.decimals)} tokens)`);
        console.log(`[DEBUG] ${tokensToCheck[1].symbol}: ${tokensToCheck[1].requiredAmount} (${Number(tokensToCheck[1].requiredAmount) / Math.pow(10, tokensToCheck[1].sdkToken.decimals)} tokens)`);

        // Check if we're dealing with native ETH
        const hasNativeETH = sortedToken0.address === ETHERS_ADDRESS_ZERO || sortedToken1.address === ETHERS_ADDRESS_ZERO;
        console.log(`[DEBUG] Pool has native ETH: ${hasNativeETH}`);

        // Check if batch permit data is provided - if so, skip approval checks
        const { permitSignature: batchPermitSignature, permitBatchData } = req.body;
        const hasBatchPermit = batchPermitSignature && permitBatchData;
        console.log(`[DEBUG] Has batch permit: ${hasBatchPermit}`);

        if (!hasBatchPermit) {
            // Only check approvals if no batch permit provided
            // First, ensure ERC20 approvals to Permit2 exist (one-time per token)
        for (const t of tokensToCheck) {
            if (getAddress(t.sdkToken.address) === ETHERS_ADDRESS_ZERO || t.requiredAmount <= 0n) continue;
            const erc20AllowanceToPermit2 = await publicClient.readContract({
                address: getAddress(t.sdkToken.address),
                abi: parseAbi(['function allowance(address owner, address spender) external view returns (uint256)']),
                functionName: 'allowance',
                args: [getAddress(userAddress), PERMIT2_ADDRESS]
            }) as bigint;
            if (erc20AllowanceToPermit2 < t.requiredAmount) {
                return res.status(200).json({
                    needsApproval: true,
                    approvalTokenAddress: t.sdkToken.address,
                    approvalTokenSymbol: t.symbol as TokenSymbol,
                    approveToAddress: PERMIT2_ADDRESS,
                    approvalAmount: maxUint256.toString(),
                    approvalType: 'ERC20_TO_PERMIT2'
                });
            }
        }

        // Build Permit2 details for non-native tokens (gasless approvals per guide)
        const latestBlockViem = await publicClient.getBlock({ blockTag: 'latest' });
        if (!latestBlockViem) throw new Error("Failed to get latest block for deadline.");
        const deadlineBigInt = latestBlockViem.timestamp + 1200n; // 20 minutes from now

        const permitDetails: { token: Hex; amount: string; expiration: string; nonce: string; symbol: TokenSymbol }[] = [];
        const currentTime = Number(latestBlockViem.timestamp);
        for (const t of tokensToCheck) {
            if (getAddress(t.sdkToken.address) === ETHERS_ADDRESS_ZERO || t.requiredAmount <= 0n) continue;
            const [permitAmt, permitExp, permitNonce] = await publicClient.readContract({
                address: PERMIT2_ADDRESS,
                abi: iallowance_transfer_abi,
                functionName: 'allowance',
                args: [getAddress(userAddress), getAddress(t.sdkToken.address), POSITION_MANAGER_ADDRESS]
            }) as readonly [amount: bigint, expiration: number, nonce: number];

            // Request a new permit only if the existing one is missing/expired/insufficient
            const hasUnlimitedAndValid = permitAmt >= MAX_UINT_160 && (permitExp === 0 || permitExp > currentTime);
            const hasEnoughAndValid = permitAmt >= t.requiredAmount && (permitExp === 0 || permitExp > currentTime);
            const needsPermit = !(hasUnlimitedAndValid || hasEnoughAndValid);
            if (!needsPermit) continue;

            permitDetails.push({
                token: getAddress(t.sdkToken.address),
                amount: MAX_UINT_160.toString(),
                expiration: deadlineBigInt.toString(),
                nonce: permitNonce.toString(),
                symbol: t.symbol as TokenSymbol
            });
        }

        if (permitDetails.length > 0 && (!permitSignature || !permitSingleData)) {
            // Return only the FIRST token that needs a permit (individual permits)
            const firstTokenNeedingPermit = permitDetails[0];
            
            const domain = {
                name: PERMIT2_DOMAIN_NAME,
                chainId: Number(chainId),
                verifyingContract: PERMIT2_ADDRESS,
            };
            const messageToSign: PermitSingleMessageForAPI = {
                details: {
                    token: firstTokenNeedingPermit.token,
                    amount: firstTokenNeedingPermit.amount,
                    expiration: Number(firstTokenNeedingPermit.expiration),
                    nonce: Number(firstTokenNeedingPermit.nonce)
                },
                spender: POSITION_MANAGER_ADDRESS,
                sigDeadline: deadlineBigInt.toString(),
            };
            return res.status(200).json({
                needsApproval: true,
                approvalTokenAddress: firstTokenNeedingPermit.token,
                approvalTokenSymbol: firstTokenNeedingPermit.symbol,
                approvalType: 'PERMIT2_SIGNATURE_FOR_PM',
                signatureDetails: {
                    domain,
                    types: PERMIT_TYPES,
                    primaryType: 'PermitSingle',
                    message: messageToSign,
                },
                permit2Address: PERMIT2_ADDRESS,
            });
        }
        } // End of approval checks
        
        // If all checks passed for both tokens, proceed to prepare the transaction using V4PositionManager
        // Calculate deadline for transaction
        const latestBlockViem = await publicClient.getBlock({ blockTag: 'latest' });
        if (!latestBlockViem) throw new Error("Failed to get latest block for deadline.");
        const deadlineBigInt = latestBlockViem.timestamp + 1200n; // 20 minutes from now

        // Create MintOptions for V4PositionManager
        let mintOptions: MintOptions = {
            slippageTolerance: new Percent(50, 10_000), // 0.5% slippage
            deadline: deadlineBigInt.toString(),
            recipient: getAddress(userAddress),
            hookData: '0x',
            // Always set when the pool involves the native token to satisfy SDK invariant
            useNative: hasNativeETH ? Ether.onChain(Number(chainId)) : undefined
        };

        // Use batch permit data if provided
        if (hasBatchPermit) {
            // Add batch permit to mint options (similar to useIncreaseLiquidity pattern)
            mintOptions = {
                ...mintOptions,
                batchPermit: {
                    owner: getAddress(userAddress),
                    permitBatch: permitBatchData,
                    signature: batchPermitSignature,
                }
            };
            console.log(`[DEBUG] Including batch permit with ${permitBatchData.details.length} tokens`);
        } else {
            // Individual permits are handled separately - no permit data needed in mint options
            // The permits have already been submitted to the Permit2 contract before this API call
            console.log(`[DEBUG] No batch permit provided - using individual permit flow`);
        }

        // Minimal debug
        
        // Note: Permits are now submitted separately to Permit2 contract before this transaction

        // Debug: Let's see what pool key the SDK is actually deriving
        console.log(`[DEBUG] SDK will derive pool key from:`);
        console.log(`[DEBUG] - sortedToken0: ${sortedToken0.address} (${sortedToken0.symbol})`);
        console.log(`[DEBUG] - sortedToken1: ${sortedToken1.address} (${sortedToken1.symbol})`);
        console.log(`[DEBUG] - fee: ${poolConfig.fee}`);
        console.log(`[DEBUG] - tickSpacing: ${poolConfig.tickSpacing}`);
        console.log(`[DEBUG] - hooks: ${poolConfig.hooks}`);
        console.log(`[DEBUG] Expected pool ID: ${poolId}`);

        // Use V4PositionManager to generate the complete call parameters
        const methodParameters = V4PositionManager.addCallParameters(position, mintOptions);
        
        const encodedModifyLiquiditiesCallDataViem = methodParameters.calldata;
        console.log(`[DEBUG] Generated calldata length:`, encodedModifyLiquiditiesCallDataViem.length);
        const transactionValue = methodParameters.value ?? "0";
        
        console.log(`[DEBUG] Transaction ready for ${token0Symbol}/${token1Symbol}`);

        return res.status(200).json({
            needsApproval: false,
            transaction: {
                to: POSITION_MANAGER_ADDRESS,
                data: encodedModifyLiquiditiesCallDataViem, 
                value: transactionValue
            },
            deadline: deadlineBigInt.toString(),
            details: {
                token0: { address: sortedToken0.address, symbol: (getToken(sortedToken0.symbol as TokenSymbol)?.symbol || sortedToken0.symbol) as TokenSymbol, amount: amount0.toString() },
                token1: { address: sortedToken1.address, symbol: (getToken(sortedToken1.symbol as TokenSymbol)?.symbol || sortedToken1.symbol) as TokenSymbol, amount: amount1.toString() },
                liquidity: liquidity.toString(), 
                finalTickLower: tickLower,
                finalTickUpper: tickUpper
            }
        });

    } catch (error: any) {
        console.error("[API prepare-mint-tx] Error:", error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
        const errorDetails = process.env.NODE_ENV === 'development' && error instanceof Error ? { name: error.name, stack: error.stack, cause: error.cause } : {};
        return res.status(500).json({ message: errorMessage, error: errorDetails });
    }
} 