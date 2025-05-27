import { Token } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position, PoolKey } from "@uniswap/v4-sdk"; 
import JSBI from 'jsbi';
import type { NextApiRequest, NextApiResponse } from 'next';

import { position_manager_abi } from "../../../lib/abis/PositionManager_abi";
import { STATE_VIEW_ABI as STATE_VIEW_HUMAN_READABLE_ABI } from "../../../lib/abis/state_view_abi"; 
import { TOKEN_DEFINITIONS, TokenSymbol } from "../../../lib/swap-constants"; 
import { iallowance_transfer_abi } from "../../../lib/abis/IAllowanceTransfer_abi"; // For Permit2 allowance method

import { publicClient } from "../../../lib/viemClient"; 
import { 
    parseUnits, 
    isAddress, 
    getAddress, 
    encodeFunctionData, 
    encodeAbiParameters, 
    encodePacked,
    parseAbi, 
    maxUint256,
    type Hex 
} from "viem";

// Constants for Permit2
import {
    PERMIT_TYPES,
    PERMIT2_DOMAIN_NAME,
    PERMIT_EXPIRATION_DURATION_SECONDS, 
    PERMIT_SIG_DEADLINE_DURATION_SECONDS, 
} from "../../../lib/swap-constants";

const POSITION_MANAGER_ADDRESS = getAddress("0x4b2c77d209d3405f41a037ec6c77f7f5b8e2ca80");
const PERMIT2_ADDRESS = getAddress("0x000000000022D473030F116dDEE9F6B43aC78BA3"); // Permit2 contract address
const STATE_VIEW_ADDRESS = getAddress("0x571291b572ed32ce6751a2cb2486ebee8defb9b4");
const DEFAULT_HOOK_ADDRESS = getAddress("0x94ba380a340E020Dc29D7883f01628caBC975000"); 
const ETHERS_ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";
const DEFAULT_FEE = 8388608;
const DEFAULT_TICK_SPACING = 60;
const SDK_MIN_TICK = -887272;
const SDK_MAX_TICK = 887272;

const Liquidity_Actions = {
    MINT_POSITION: 0x02,
    SETTLE_PAIR: 0x0D,
};

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
            chainId
        } = req.body;

        if (!isAddress(userAddress)) {
            return res.status(400).json({ message: "Invalid userAddress." });
        }
        if (!TOKEN_DEFINITIONS[token0Symbol] || !TOKEN_DEFINITIONS[token1Symbol] || !TOKEN_DEFINITIONS[inputTokenSymbol]) {
            return res.status(400).json({ message: "Invalid token symbol(s) provided." });
        }
        if (isNaN(parseFloat(inputAmount)) || parseFloat(inputAmount) <= 0) {
            return res.status(400).json({ message: "Invalid inputAmount." });
        }
        if (typeof userTickLower !== 'number' || typeof userTickUpper !== 'number') {
            return res.status(400).json({ message: "userTickLower and userTickUpper must be numbers." });
        }

        const token0Config = TOKEN_DEFINITIONS[token0Symbol];
        const token1Config = TOKEN_DEFINITIONS[token1Symbol];

        const sdkToken0 = new Token(chainId, getAddress(token0Config.addressRaw), token0Config.decimals, token0Config.symbol);
        const sdkToken1 = new Token(chainId, getAddress(token1Config.addressRaw), token1Config.decimals, token1Config.symbol);
        
        const inputTokenIsSdkToken0 = inputTokenSymbol === token0Symbol;
        const sdkInputToken = inputTokenIsSdkToken0 ? sdkToken0 : sdkToken1;
        const parsedInputAmount_BigInt = parseUnits(inputAmount, sdkInputToken.decimals); 
        const parsedInputAmount_JSBI = JSBI.BigInt(parsedInputAmount_BigInt.toString()); 

        const clampedUserTickLower = Math.max(userTickLower, SDK_MIN_TICK);
        const clampedUserTickUpper = Math.min(userTickUpper, SDK_MAX_TICK);
        const finalTickLower = Math.ceil(clampedUserTickLower / DEFAULT_TICK_SPACING) * DEFAULT_TICK_SPACING;
        const finalTickUpper = Math.floor(clampedUserTickUpper / DEFAULT_TICK_SPACING) * DEFAULT_TICK_SPACING;

        if (finalTickLower >= finalTickUpper) {
            return res.status(400).json({ message: `Error: finalTickLower (${finalTickLower}) must be less than finalTickUpper (${finalTickUpper}) after alignment.` });
        }

        const [sortedToken0, sortedToken1] = sdkToken0.sortsBefore(sdkToken1) 
            ? [sdkToken0, sdkToken1] 
            : [sdkToken1, sdkToken0];
        
        const poolKey: PoolKey = {
            currency0: sortedToken0.address, 
            currency1: sortedToken1.address, 
            fee: DEFAULT_FEE,
            tickSpacing: DEFAULT_TICK_SPACING,
            hooks: DEFAULT_HOOK_ADDRESS     
        };
        const poolId = V4Pool.getPoolId(sortedToken0, sortedToken1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks);

        let rawSqrtPriceX96String: string;
        let currentTickFromSlot0: number;
        let lpFeeFromSlot0: number;
        let currentSqrtPriceX96_JSBI: JSBI;

        try {
            const slot0DataViem = await publicClient.readContract({
                address: STATE_VIEW_ADDRESS,
                abi: stateViewAbiViem,
                functionName: 'getSlot0',
                args: [poolId as Hex]
            }) as readonly [bigint, number, number, number];
            rawSqrtPriceX96String = slot0DataViem[0].toString();
            currentTickFromSlot0 = Number(slot0DataViem[1]);
            lpFeeFromSlot0 = Number(slot0DataViem[3]);
            currentSqrtPriceX96_JSBI = JSBI.BigInt(rawSqrtPriceX96String);
        } catch (error) {
            console.error("API Error (prepare-mint-tx) fetching pool slot0 data:", error);
            return res.status(500).json({ message: "Failed to fetch current pool data.", error });
        }

        const v4PoolForCalc = new V4Pool(
            sortedToken0,
            sortedToken1,
            lpFeeFromSlot0, 
            DEFAULT_TICK_SPACING,
            ETHERS_ADDRESS_ZERO as `0x${string}`,
            currentSqrtPriceX96_JSBI, 
            JSBI.BigInt(0), 
            currentTickFromSlot0
        );

        let positionForCalc: V4Position;
        if (sdkInputToken.address === sortedToken0.address) {
            positionForCalc = V4Position.fromAmount0({
                pool: v4PoolForCalc,
                tickLower: finalTickLower,
                tickUpper: finalTickUpper,
                amount0: parsedInputAmount_JSBI, 
                useFullPrecision: true
            });
        } else { 
            positionForCalc = V4Position.fromAmount1({
                pool: v4PoolForCalc,
                tickLower: finalTickLower,
                tickUpper: finalTickUpper,
                amount1: parsedInputAmount_JSBI
            });
        }
        
        const calculatedLiquidity_JSBI = positionForCalc.liquidity;
        const sdkCalculatedAmountSorted0_BigInt = BigInt(positionForCalc.mintAmounts.amount0.toString());
        const sdkCalculatedAmountSorted1_BigInt = BigInt(positionForCalc.mintAmounts.amount1.toString());

        const MAX_UINT_128 = (1n << 128n) - 1n;
        if (JSBI.GT(calculatedLiquidity_JSBI, JSBI.BigInt(MAX_UINT_128.toString()))) {
            return res.status(400).json({
                message: "The selected price range is too narrow for the provided input amount, resulting in an impractically large liquidity value."
            });
        }
        
        const isFullRange = (finalTickLower === SDK_MIN_TICK && finalTickUpper === SDK_MAX_TICK);
        if (!isFullRange && (sdkCalculatedAmountSorted0_BigInt <= 0n || sdkCalculatedAmountSorted1_BigInt <= 0n)) {
            if (sdkCalculatedAmountSorted0_BigInt > 0n || sdkCalculatedAmountSorted1_BigInt > 0n) { 
                return res.status(400).json({
                    message: "The calculated amounts for your selected price range would result in providing liquidity for only one token. Please adjust your input or range, or use 'Full Range' for one-sided concentration."
                });
            }
            if (sdkCalculatedAmountSorted0_BigInt <= 0n && sdkCalculatedAmountSorted1_BigInt <= 0n && JSBI.GT(calculatedLiquidity_JSBI, JSBI.BigInt(0))) {
                 return res.status(400).json({ message: "Calculation resulted in zero amounts for both tokens but positive liquidity. This is an unlikely scenario, please check inputs." });
            }
             if (sdkCalculatedAmountSorted0_BigInt <= 0n && sdkCalculatedAmountSorted1_BigInt <= 0n && JSBI.LE(calculatedLiquidity_JSBI, JSBI.BigInt(0))) { 
                 return res.status(400).json({ message: "Calculation resulted in zero amounts and zero liquidity. Please provide a valid input amount and range." });
            }
        }

        const tokensToCheck = [
            { sdkToken: sortedToken0, requiredAmount: sdkCalculatedAmountSorted0_BigInt, symbol: TOKEN_DEFINITIONS[sortedToken0.symbol as TokenSymbol]?.symbol || sortedToken0.symbol || "Token0" },
            { sdkToken: sortedToken1, requiredAmount: sdkCalculatedAmountSorted1_BigInt, symbol: TOKEN_DEFINITIONS[sortedToken1.symbol as TokenSymbol]?.symbol || sortedToken1.symbol || "Token1" }
        ];

        for (const tokenInfo of tokensToCheck) {
            if (getAddress(tokenInfo.sdkToken.address) === ETHERS_ADDRESS_ZERO || tokenInfo.requiredAmount <= 0n) {
                continue;
            }

            // --- Step 1: Check ERC20 Allowance from User to Permit2 ---
            const eoaToPermit2Erc20Allowance = await publicClient.readContract({
                address: getAddress(tokenInfo.sdkToken.address),
                abi: parseAbi(['function allowance(address owner, address spender) external view returns (uint256)']),
                functionName: 'allowance',
                args: [getAddress(userAddress), PERMIT2_ADDRESS]
            }) as bigint;

            if (eoaToPermit2Erc20Allowance < tokenInfo.requiredAmount) {
                return res.status(200).json({
                    needsApproval: true,
                    approvalTokenAddress: tokenInfo.sdkToken.address,
                    approvalTokenSymbol: tokenInfo.symbol as TokenSymbol,
                    approveToAddress: PERMIT2_ADDRESS, 
                    approvalAmount: maxUint256.toString(), // Request max approval
                    approvalType: 'ERC20_TO_PERMIT2'
                });
            }

            // --- Step 2: Check Permit2 Allowance for PositionManager ---
            // This allowance is set when user signs a PermitSingle message and it's submitted via Permit2.permit()
            // or if they've done a manual Permit2.approve() to the PositionManager.
            const permit2AllowanceTuple = await publicClient.readContract({
                address: PERMIT2_ADDRESS,
                abi: iallowance_transfer_abi, 
                functionName: 'allowance',
                args: [getAddress(userAddress), getAddress(tokenInfo.sdkToken.address), POSITION_MANAGER_ADDRESS]
            }) as readonly [amount: bigint, expiration: number, nonce: number];
            
            const permit2SpenderAmount = permit2AllowanceTuple[0];
            const permit2SpenderExpiration = permit2AllowanceTuple[1];
            const permit2SpenderNonce = permit2AllowanceTuple[2]; // This nonce is crucial for the signature

            const currentTimestamp = Math.floor(Date.now() / 1000);
            let needsPermitSignature = false;

            // Permit2 uses uint160 for amounts in PermitSingle. If we need more, we check against MAX_UINT_160.
            // Otherwise, we check against the specific required amount.
            if (tokenInfo.requiredAmount > MAX_UINT_160) { 
                if (permit2SpenderAmount < MAX_UINT_160) {
                    needsPermitSignature = true;
                }
            } else {
                if (permit2SpenderAmount < tokenInfo.requiredAmount) {
                    needsPermitSignature = true;
                }
            }

            // Also need a new permit if the current one is expired (and an amount is actually needed)
            // An expiration of 0 usually means it's an uninitialized slot or an "infinite" approval that doesn't expire via timestamp.
            // However, if an amount was previously permitted and it expired, we need a new one.
            if (!needsPermitSignature && permit2SpenderExpiration !== 0 && permit2SpenderExpiration <= currentTimestamp && tokenInfo.requiredAmount > 0n) {
                needsPermitSignature = true;
            }
            
            if (needsPermitSignature) {
                const permitExpirationTimestamp = BigInt(currentTimestamp + PERMIT_EXPIRATION_DURATION_SECONDS);
                const sigDeadlineTimestamp = BigInt(currentTimestamp + PERMIT_SIG_DEADLINE_DURATION_SECONDS);

                const domain = {
                    name: PERMIT2_DOMAIN_NAME,
                    chainId: Number(chainId),
                    verifyingContract: PERMIT2_ADDRESS,
                };

                // The message for the user to sign.
                const messageToSign: PermitSingleMessageForAPI = {
                    details: {
                        token: getAddress(tokenInfo.sdkToken.address),
                        amount: MAX_UINT_160.toString(), 
                        expiration: Number(permitExpirationTimestamp), 
                        nonce: permit2SpenderNonce, 
                    },
                    spender: POSITION_MANAGER_ADDRESS,
                    sigDeadline: sigDeadlineTimestamp.toString(), 
                };
                
                return res.status(200).json({
                    needsApproval: true,
                    approvalTokenAddress: tokenInfo.sdkToken.address,
                    approvalTokenSymbol: tokenInfo.symbol as TokenSymbol,
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
        }
        
        // If all checks passed for both tokens, proceed to prepare the transaction
        const actions = [Liquidity_Actions.MINT_POSITION, Liquidity_Actions.SETTLE_PAIR];
        const actionsPackedTypes = actions.map(() => 'uint8' as const);
        const actionsPackedValues = actions.map(a => a);
        const actionsEncodedViem = encodePacked(actionsPackedTypes, actionsPackedValues);
        
        const poolKeyTupleData = { 
            currency0: poolKey.currency0 as `0x${string}`,
            currency1: poolKey.currency1 as `0x${string}`,
            fee: poolKey.fee,
            tickSpacing: poolKey.tickSpacing,
            hooks: poolKey.hooks as `0x${string}`
        };

        const params0Viem = encodeAbiParameters(
            [
                {
                    type: 'tuple',
                    components: [
                        { name: 'currency0', type: 'address' },
                        { name: 'currency1', type: 'address' },
                        { name: 'fee', type: 'uint24' },
                        { name: 'tickSpacing', type: 'int24' },
                        { name: 'hooks', type: 'address' },
                    ],
                    name: 'poolKey'
                },
                { type: 'int24', name: 'tickLower' },  
                { type: 'int24', name: 'tickUpper' },  
                { type: 'uint128', name: 'liquidity' },
                { type: 'uint256', name: 'amount0Desired' }, 
                { type: 'uint256', name: 'amount1Desired' }, 
                { type: 'address', name: 'recipient' },
                { type: 'bytes', name: 'data' }    
            ],
            [
                poolKeyTupleData, 
                finalTickLower, 
                finalTickUpper, 
                BigInt(calculatedLiquidity_JSBI.toString()), 
                sdkCalculatedAmountSorted0_BigInt, 
                sdkCalculatedAmountSorted1_BigInt, 
                getAddress(userAddress), 
                '0x' as Hex 
            ]
        );
        
        const params1Viem = encodeAbiParameters(
            [{ type: 'address' }, { type: 'address' }],
            [getAddress(sortedToken0.address), getAddress(sortedToken1.address)]
        );
        
        const paramsArray = [params0Viem, params1Viem];
        
        const latestBlockViem = await publicClient.getBlock({ blockTag: 'latest' });
        if (!latestBlockViem) throw new Error("Failed to get latest block for deadline.");
        const deadlineBigInt = latestBlockViem.timestamp + 60n;

        const unlockDataViem = encodeAbiParameters(
            [{ type: 'bytes' }, { type: 'bytes[]' }],
            [actionsEncodedViem, paramsArray]
        ) as Hex;

        const deadlineArg = deadlineBigInt;

        const encodedModifyLiquiditiesCallDataViem = encodeFunctionData({
            abi: position_manager_abi,
            functionName: 'modifyLiquidities',
            args: [unlockDataViem, deadlineArg]
        });

        return res.status(200).json({
            needsApproval: false,
            transaction: {
                to: POSITION_MANAGER_ADDRESS,
                data: encodedModifyLiquiditiesCallDataViem, 
                value: "0"
            },
            deadline: deadlineBigInt.toString(),
            details: {
                token0: { address: sortedToken0.address, symbol: (TOKEN_DEFINITIONS[sortedToken0.symbol as TokenSymbol]?.symbol || sortedToken0.symbol) as TokenSymbol, amount: sdkCalculatedAmountSorted0_BigInt.toString() },
                token1: { address: sortedToken1.address, symbol: (TOKEN_DEFINITIONS[sortedToken1.symbol as TokenSymbol]?.symbol || sortedToken1.symbol) as TokenSymbol, amount: sdkCalculatedAmountSorted1_BigInt.toString() },
                liquidity: calculatedLiquidity_JSBI.toString(), 
                finalTickLower,
                finalTickUpper
            }
        });

    } catch (error: any) {
        console.error("[API prepare-mint-tx] Error:", error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
        const errorDetails = process.env.NODE_ENV === 'development' && error instanceof Error ? { name: error.name, stack: error.stack, cause: error.cause } : {};
        return res.status(500).json({ message: errorMessage, error: errorDetails });
    }
} 