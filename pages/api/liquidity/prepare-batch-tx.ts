import { Token, Percent, Ether } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position, V4PositionManager } from "@uniswap/v4-sdk";
import type { MintOptions, RemoveLiquidityOptions } from "@uniswap/v4-sdk";
import { nearestUsableTick } from '@uniswap/v3-sdk';
import JSBI from 'jsbi';
import type { NextApiRequest, NextApiResponse } from 'next';

import { STATE_VIEW_ABI as STATE_VIEW_HUMAN_READABLE_ABI } from "@/lib/abis/state_view_abi";
import { TokenSymbol, getToken, getPositionManagerAddress, getStateViewAddress } from "../../../lib/pools-config";
import { iallowance_transfer_abi } from "../../../lib/abis/IAllowanceTransfer_abi";

import { publicClient } from "../../../lib/viemClient";
import {
    isAddress,
    getAddress,
    parseAbi,
    maxUint256,
    parseUnits,
    encodeAbiParameters,
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
const PERMIT2_ADDRESS = getAddress("0x000000000022D473030F116dDEE9F6B43aC78BA3");
const STATE_VIEW_ADDRESS = getStateViewAddress();
const ETHERS_ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";
const SDK_MIN_TICK = -887272;
const SDK_MAX_TICK = 887272;
const MAX_UINT_160 = (1n << 160n) - 1n;

// Transaction types for batching
type TransactionType = 'approve' | 'permit' | 'mint' | 'decrease' | 'collect';

interface BatchTransactionRequest {
    type: TransactionType;
    to: string;
    data: string;
    value: string;
    description: string;
}

interface PermitDetails {
    token: string;
    amount: string;
    expiration: number;
    nonce: number;
}

interface PermitBatchData {
    details: PermitDetails[];
    spender: string;
    sigDeadline: string;
    signature?: string;
}

interface BatchOperationRequest extends NextApiRequest {
    body: {
        userAddress: string;
        chainId: number;
        operations: Array<{
            type: 'mint' | 'decrease' | 'collect';
            // Mint operation data
            token0Symbol?: TokenSymbol;
            token1Symbol?: TokenSymbol;
            inputAmount?: string;
            inputTokenSymbol?: TokenSymbol;
            userTickLower?: number;
            userTickUpper?: number;
            // Decrease operation data
            tokenId?: string | number;
            liquidityPercentage?: number;
            tickLower?: number;
            tickUpper?: number;
            collectFees?: boolean;
        }>;
        // Batch permit data
        permitBatchData?: PermitBatchData;
        // Whether to use atomic batching (EIP-5792)
        useAtomicBatching?: boolean;
    };
}

interface BatchTransactionResponse {
    needsApproval: boolean;
    useAtomicBatching: boolean;
    transactions: BatchTransactionRequest[];
    permitData?: {
        domain: any;
        types: any;
        value: any;
    };
    deadline: string;
    batchId?: string;
    details: {
        operations: Array<{
            type: string;
            token0?: { address: string; symbol: TokenSymbol; amount: string; };
            token1?: { address: string; symbol: TokenSymbol; amount: string; };
            liquidityAmount?: string;
            fees?: { token0: string; token1: string; };
        }>;
    };
}

type PrepareBatchTxResponse = BatchTransactionResponse | { message: string; error?: any };

export default async function handler(
    req: BatchOperationRequest,
    res: NextApiResponse<PrepareBatchTxResponse>
) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
    }

    const stateViewAbiViem = parseAbi(STATE_VIEW_HUMAN_READABLE_ABI);

    try {
        const {
            userAddress,
            chainId,
            operations,
            permitBatchData,
            useAtomicBatching = false
        } = req.body;

        if (!isAddress(userAddress)) {
            return res.status(400).json({ message: "Invalid userAddress." });
        }

        if (!operations || operations.length === 0) {
            return res.status(400).json({ message: "No operations provided." });
        }

        // Generate batch ID for tracking
        const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Calculate deadline for all transactions
        const latestBlockViem = await publicClient.getBlock({ blockTag: 'latest' });
        if (!latestBlockViem) throw new Error("Failed to get latest block for deadline.");
        const deadlineBigInt = latestBlockViem.timestamp + 1200n; // 20 minutes from now

        const batchTransactions: BatchTransactionRequest[] = [];
        const operationDetails: any[] = [];
        let needsApproval = false;

        // Process batch permit if provided
        if (permitBatchData && permitBatchData.signature) {
            // Add permit transaction to batch
            const permitCalldata = encodePermitBatchCalldata(permitBatchData);
            batchTransactions.push({
                type: 'permit',
                to: PERMIT2_ADDRESS,
                data: permitCalldata,
                value: "0",
                description: `Batch permit for ${permitBatchData.details.length} tokens`
            });
        }

        // Process each operation
        for (let i = 0; i < operations.length; i++) {
            const operation = operations[i];

            if (operation.type === 'mint') {
                const mintResult = await prepareMintOperation(
                    operation,
                    userAddress,
                    chainId,
                    deadlineBigInt,
                    stateViewAbiViem
                );

                if (mintResult.needsApproval && !permitBatchData) {
                    needsApproval = true;
                }

                batchTransactions.push(...mintResult.transactions);
                operationDetails.push(mintResult.details);

            } else if (operation.type === 'decrease') {
                const decreaseResult = await prepareDecreaseOperation(
                    operation,
                    userAddress,
                    chainId,
                    deadlineBigInt,
                    stateViewAbiViem
                );

                batchTransactions.push(...decreaseResult.transactions);
                operationDetails.push(decreaseResult.details);

            } else if (operation.type === 'collect') {
                const collectResult = await prepareCollectOperation(
                    operation,
                    userAddress,
                    chainId,
                    deadlineBigInt
                );

                batchTransactions.push(...collectResult.transactions);
                operationDetails.push(collectResult.details);
            }
        }

        // Prepare permit data for signing if no signature provided
        let permitData = undefined;
        if (permitBatchData && !permitBatchData.signature) {
            permitData = generatePermitBatchTypedData(permitBatchData, chainId);
        }

        console.log(`[DEBUG] Prepared batch transaction with ${batchTransactions.length} operations`);
        console.log(`[DEBUG] Atomic batching: ${useAtomicBatching}, Needs approval: ${needsApproval}`);

        return res.status(200).json({
            needsApproval,
            useAtomicBatching,
            transactions: batchTransactions,
            permitData,
            deadline: deadlineBigInt.toString(),
            batchId,
            details: {
                operations: operationDetails
            }
        });

    } catch (error: any) {
        console.error("[API prepare-batch-tx] Error:", error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
        const errorDetails = process.env.NODE_ENV === 'development' && error instanceof Error
            ? { name: error.name, stack: error.stack, cause: error.cause }
            : {};
        return res.status(500).json({ message: errorMessage, error: errorDetails });
    }
}

// Helper function to prepare mint operation
async function prepareMintOperation(
    operation: any,
    userAddress: string,
    chainId: number,
    deadline: bigint,
    stateViewAbiViem: any
) {
    const {
        token0Symbol,
        token1Symbol,
        inputAmount,
        inputTokenSymbol,
        userTickLower,
        userTickUpper
    } = operation;

    // Validate required fields
    if (!token0Symbol || !token1Symbol || !inputAmount || !inputTokenSymbol) {
        throw new Error("Missing required mint operation parameters");
    }

    const token0Config = getToken(token0Symbol);
    const token1Config = getToken(token1Symbol);

    if (!token0Config || !token1Config) {
        throw new Error("Invalid token symbol(s) provided.");
    }

    // Get pool configuration and validate
    const { getPoolByTokens } = await import('../../../lib/pools-config');
    const poolConfig = getPoolByTokens(token0Symbol, token1Symbol);

    if (!poolConfig) {
        throw new Error(`No pool configuration found for ${token0Symbol}/${token1Symbol}`);
    }

    // Create SDK tokens
    const sdkToken0 = new Token(chainId, getAddress(token0Config.address), token0Config.decimals, token0Config.symbol);
    const sdkToken1 = new Token(chainId, getAddress(token1Config.address), token1Config.decimals, token1Config.symbol);

    // Process tick range
    const clampedTickLower = Math.max(userTickLower, SDK_MIN_TICK);
    const clampedTickUpper = Math.min(userTickUpper, SDK_MAX_TICK);
    let finalTickLower = nearestUsableTick(clampedTickLower, poolConfig.tickSpacing);
    let finalTickUpper = nearestUsableTick(clampedTickUpper, poolConfig.tickSpacing);

    if (finalTickLower >= finalTickUpper) {
        finalTickLower = finalTickUpper - poolConfig.tickSpacing;
    }

    // Get current pool state
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

    // Query current pool state
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
    const currentTick = slot0[1] as number;
    const currentLiquidity = liquidity as bigint;

    if (sqrtPriceX96Current === 0n) {
        throw new Error(`Pool ${token0Symbol}/${token1Symbol} is not initialized.`);
    }

    // Create pool and position
    const poolCurrency0 = sortedToken0.address === ETHERS_ADDRESS_ZERO ? Ether.onChain(Number(chainId)) : sortedToken0;
    const poolCurrency1 = sortedToken1.address === ETHERS_ADDRESS_ZERO ? Ether.onChain(Number(chainId)) : sortedToken1;

    const v4Pool = new V4Pool(
        poolCurrency0 as any,
        poolCurrency1 as any,
        poolConfig.fee,
        poolConfig.tickSpacing,
        poolConfig.hooks as `0x${string}`,
        JSBI.BigInt(sqrtPriceX96Current.toString()),
        JSBI.BigInt(currentLiquidity.toString()),
        currentTick
    );

    // Calculate amounts and create position
    const inputToken = getToken(inputTokenSymbol);
    if (!inputToken) {
        throw new Error(`Invalid input token: ${inputTokenSymbol}`);
    }

    const inputAmountParsed = parseUnits(inputAmount, inputToken.decimals);
    const inputCurrencyAmount = Token.fromRawAmount(
        inputTokenSymbol === token0Symbol ? sortedToken0 : sortedToken1,
        inputAmountParsed.toString()
    );

    const position = V4Position.fromAmount1(
        v4Pool,
        finalTickLower,
        finalTickUpper,
        inputCurrencyAmount.quotient
    );

    // Create mint options
    const hasNativeETH = sortedToken0.address === ETHERS_ADDRESS_ZERO || sortedToken1.address === ETHERS_ADDRESS_ZERO;

    const mintOptions: MintOptions = {
        slippageTolerance: new Percent(50, 10_000), // 0.5% slippage
        deadline: deadline.toString(),
        useNative: hasNativeETH ? Ether.onChain(Number(chainId)) : undefined
    } as any;

    // Generate mint transaction
    const methodParameters = V4PositionManager.addCallParameters(position, mintOptions);

    const transactions: BatchTransactionRequest[] = [{
        type: 'mint',
        to: POSITION_MANAGER_ADDRESS,
        data: methodParameters.calldata,
        value: methodParameters.value ?? "0",
        description: `Add liquidity to ${token0Symbol}/${token1Symbol}`
    }];

    return {
        needsApproval: false, // Handled by permits
        transactions,
        details: {
            type: 'mint',
            token0: {
                address: sortedToken0.address,
                symbol: (getToken(sortedToken0.symbol as TokenSymbol)?.symbol || sortedToken0.symbol) as TokenSymbol,
                amount: position.amount0.toString()
            },
            token1: {
                address: sortedToken1.address,
                symbol: (getToken(sortedToken1.symbol as TokenSymbol)?.symbol || sortedToken1.symbol) as TokenSymbol,
                amount: position.amount1.toString()
            },
            liquidityAmount: position.liquidity.toString()
        }
    };
}

// Helper function to prepare decrease operation
async function prepareDecreaseOperation(
    operation: any,
    userAddress: string,
    chainId: number,
    deadline: bigint,
    stateViewAbiViem: any
) {
    const {
        tokenId,
        token0Symbol,
        token1Symbol,
        liquidityPercentage,
        tickLower,
        tickUpper,
        collectFees = true
    } = operation;

    // Validate required fields
    if (!tokenId || !token0Symbol || !token1Symbol || liquidityPercentage === undefined) {
        throw new Error("Missing required decrease operation parameters");
    }

    // Get pool configuration
    const { getPoolByTokens } = await import('../../../lib/pools-config');
    const poolConfig = getPoolByTokens(token0Symbol, token1Symbol);

    if (!poolConfig) {
        throw new Error(`No pool configuration found for ${token0Symbol}/${token1Symbol}`);
    }

    const token0Config = getToken(token0Symbol);
    const token1Config = getToken(token1Symbol);

    if (!token0Config || !token1Config) {
        throw new Error("Invalid token symbol(s) provided.");
    }

    // Create SDK tokens and pool (similar to mint operation)
    const sdkToken0 = new Token(chainId, getAddress(token0Config.address), token0Config.decimals, token0Config.symbol);
    const sdkToken1 = new Token(chainId, getAddress(token1Config.address), token1Config.decimals, token1Config.symbol);

    const [sortedToken0, sortedToken1] = sdkToken0.sortsBefore(sdkToken1)
        ? [sdkToken0, sdkToken1]
        : [sdkToken1, sdkToken0];

    // For decrease operations, we need position data (placeholder for now)
    const positionLiquidity = JSBI.BigInt("1000000000000000000"); // Should be queried from NFT

    const hasNativeETH = sortedToken0.address === ETHERS_ADDRESS_ZERO || sortedToken1.address === ETHERS_ADDRESS_ZERO;
    const isFullBurn = liquidityPercentage >= 100;

    const removeOptions: RemoveLiquidityOptions = {
        tokenId: BigInt(tokenId.toString()),
        liquidityPercentage: new Percent(liquidityPercentage, 100),
        slippageTolerance: new Percent(50, 10_000), // 0.5% slippage
        deadline: deadline.toString(),
        burnToken: isFullBurn,
        useNative: hasNativeETH ? Ether.onChain(Number(chainId)) : undefined
    } as any;

    // Create position (simplified - should use actual position data)
    const position = new V4Position({
        pool: {} as any, // Placeholder
        liquidity: positionLiquidity,
        tickLower: tickLower || SDK_MIN_TICK,
        tickUpper: tickUpper || SDK_MAX_TICK
    });

    const methodParameters = V4PositionManager.removeCallParameters(position, removeOptions);

    const transactions: BatchTransactionRequest[] = [{
        type: 'decrease',
        to: POSITION_MANAGER_ADDRESS,
        data: methodParameters.calldata,
        value: methodParameters.value ?? "0",
        description: `Remove ${liquidityPercentage}% liquidity from position ${tokenId}`
    }];

    return {
        transactions,
        details: {
            type: 'decrease',
            liquidityAmount: JSBI.divide(
                JSBI.multiply(positionLiquidity, JSBI.BigInt(Math.floor(liquidityPercentage))),
                JSBI.BigInt(100)
            ).toString()
        }
    };
}

// Helper function to prepare collect operation
async function prepareCollectOperation(
    operation: any,
    userAddress: string,
    chainId: number,
    deadline: bigint
) {
    const { tokenId } = operation;

    if (!tokenId) {
        throw new Error("Missing tokenId for collect operation");
    }

    // Placeholder for collect operation
    const transactions: BatchTransactionRequest[] = [{
        type: 'collect',
        to: POSITION_MANAGER_ADDRESS,
        data: "0x", // Placeholder - would encode collect parameters
        value: "0",
        description: `Collect fees from position ${tokenId}`
    }];

    return {
        transactions,
        details: {
            type: 'collect',
            fees: { token0: "0", token1: "0" } // Placeholder
        }
    };
}

// Helper function to encode permit batch calldata
function encodePermitBatchCalldata(permitBatchData: PermitBatchData): string {
    // Placeholder implementation - would encode permit2 batch call
    return "0x";
}

// Helper function to generate typed data for permit batch signing
function generatePermitBatchTypedData(permitBatchData: PermitBatchData, chainId: number) {
    return {
        domain: {
            name: PERMIT2_DOMAIN_NAME,
            chainId: chainId,
            verifyingContract: PERMIT2_ADDRESS
        },
        types: PERMIT_TYPES,
        value: {
            details: permitBatchData.details,
            spender: permitBatchData.spender,
            sigDeadline: permitBatchData.sigDeadline
        }
    };
}