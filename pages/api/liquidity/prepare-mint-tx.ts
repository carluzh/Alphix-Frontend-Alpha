import { ethers, BigNumber } from "ethers";
import { Token } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position, PoolKey } from "@uniswap/v4-sdk"; 
import JSBI from 'jsbi';
// import dotenv from "dotenv"; // Removed
import type { NextApiRequest, NextApiResponse } from 'next';

import { position_manager_abi } from "../../../lib/abis/PositionManager_abi";
import { iallowance_transfer_abi } from "../../../lib/abis/IAllowanceTransfer_abi";
import { STATE_VIEW_ABI as STATE_VIEW_HUMAN_READABLE_ABI } from "../../../lib/abis/state_view_abi"; // Renamed for clarity
import { TOKEN_DEFINITIONS, TokenSymbol } from "../../../lib/swap-constants"; // Assuming similar structure to swap

import { publicClient } from "../../../lib/viemClient"; // Import publicClient
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

// Load environment variables
// dotenv.config({ path: '.env.local' }); // Removed: Next.js handles .env.local automatically

// const RPC_URL = process.env.RPC_URL; // No longer directly used

// Contract addresses (should be chain-dependent if supporting multiple chains)
const POSITION_MANAGER_ADDRESS = getAddress("0x4b2c77d209d3405f41a037ec6c77f7f5b8e2ca80");
const PERMIT2_ADDRESS = getAddress("0x000000000022D473030F116dDEE9F6B43aC78BA3");
const STATE_VIEW_ADDRESS = getAddress("0x571291b572ed32ce6751a2cb2486ebee8defb9b4");
// Use the canonical, checksummed hook address from other parts of the codebase
const DEFAULT_HOOK_ADDRESS = getAddress("0x94ba380a340E020Dc29D7883f01628caBC975000"); 
const ETHERS_ADDRESS_ZERO = "0x0000000000000000000000000000000000000000"; // Viem doesn't export a const for this
const DEFAULT_FEE = 8388608; // This is uint24
const DEFAULT_TICK_SPACING = 60;
const SDK_MIN_TICK = -887272;
const SDK_MAX_TICK = 887272;

// Define action constants from full_range.ts
const Liquidity_Actions = {
    MINT_POSITION: 0x02,
    SETTLE_PAIR: 0x0D,
    // Add others if they become necessary for other flows via this API
};

interface PrepareMintTxRequest extends NextApiRequest {
    body: {
        userAddress: string;
        token0Symbol: TokenSymbol; // e.g., YUSDC, BTCRL
        token1Symbol: TokenSymbol;
        inputAmount: string;      // Amount of inputTokenSymbol to provide
        inputTokenSymbol: TokenSymbol; // The token for which inputAmount is specified
        userTickLower: number;
        userTickUpper: number;
        chainId: number; 
    };
}

interface ApprovalNeededResponse {
    needsApproval: true;
    approvalTokenAddress: string;
    approvalTokenSymbol: TokenSymbol;
    approveToAddress: string;
    approvalAmount: string; // e.g., MaxUint256 as string
}

interface TransactionPreparedResponse {
    needsApproval: false;
    transaction: {
        to: string;
        data: string; // Hex string for encoded function call
        value: string; // Typically "0"
    };
    deadline: string; // Unix timestamp string
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

    // RPC_URL check is implicitly handled by publicClient initialization in lib/viemClient.ts
    // if (!RPC_URL) { 
    //     console.error("API Error: RPC_URL is not configured.");
    //     return res.status(500).json({ message: "Server configuration error: RPC_URL missing." });
    // }
    // const provider = new ethers.providers.JsonRpcProvider(RPC_URL); // Removed

    // Parse necessary ABIs for Viem
    const stateViewAbiViem = parseAbi(STATE_VIEW_HUMAN_READABLE_ABI);
    // iallowance_transfer_abi and position_manager_abi are already in JSON format suitable for Viem

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

        // Validate inputs
        if (!isAddress(userAddress)) { // Use viem's isAddress
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
        // TODO: Add more validation for chainId, perhaps ensure it matches a configured supported ID

        const token0Config = TOKEN_DEFINITIONS[token0Symbol];
        const token1Config = TOKEN_DEFINITIONS[token1Symbol];

        const sdkToken0 = new Token(chainId, getAddress(token0Config.addressRaw), token0Config.decimals, token0Config.symbol);
        const sdkToken1 = new Token(chainId, getAddress(token1Config.addressRaw), token1Config.decimals, token1Config.symbol);
        
        const inputTokenIsToken0 = inputTokenSymbol === token0Symbol;
        const inputToken = inputTokenIsToken0 ? sdkToken0 : sdkToken1;
        const parsedInputAmount = parseUnits(inputAmount, inputToken.decimals); // Returns bigint

        // --- Tick Alignment (from full_range.ts) ---
        const clampedUserTickLower = Math.max(userTickLower, SDK_MIN_TICK);
        const clampedUserTickUpper = Math.min(userTickUpper, SDK_MAX_TICK);
        const finalTickLower = Math.ceil(clampedUserTickLower / DEFAULT_TICK_SPACING) * DEFAULT_TICK_SPACING;
        const finalTickUpper = Math.floor(clampedUserTickUpper / DEFAULT_TICK_SPACING) * DEFAULT_TICK_SPACING;

        if (finalTickLower >= finalTickUpper) {
            return res.status(400).json({ message: `Error: finalTickLower (${finalTickLower}) must be less than finalTickUpper (${finalTickUpper}) after alignment.` });
        }

        // --- Token Sorting and Pool ID (from full_range.ts) ---
        const [sortedToken0, sortedToken1] = sdkToken0.sortsBefore(sdkToken1) 
            ? [sdkToken0, sdkToken1] 
            : [sdkToken1, sdkToken0];
        const isOrderSwapped = sortedToken0.address !== sdkToken0.address;
        
        const poolKey: PoolKey = {
            currency0: sortedToken0.address as `0x${string}`,
            currency1: sortedToken1.address as `0x${string}`,
            fee: DEFAULT_FEE, // Already a number, ensure it's treated as uint24
            tickSpacing: DEFAULT_TICK_SPACING,
            hooks: DEFAULT_HOOK_ADDRESS
        };
        const poolId = V4Pool.getPoolId(sortedToken0, sortedToken1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks);

        // --- Fetch Pool Slot0 (from full_range.ts) ---
        // const stateViewContract = new ethers.Contract(STATE_VIEW_ADDRESS, STATE_VIEW_ABI, provider); // Removed
        let slot0;
        try {
            // const slot0DataEthers = await stateViewContract.getSlot0(poolId); // Old
            const slot0DataViem = await publicClient.readContract({
                address: STATE_VIEW_ADDRESS,
                abi: stateViewAbiViem, // Use parsed ABI
                functionName: 'getSlot0',
                args: [poolId as Hex]
            }) as readonly [bigint, number, number, number]; // [sqrtPriceX96, tick, protocolFee, lpFee]

            slot0 = {
                sqrtPriceX96: slot0DataViem[0].toString(),
                tick: Number(slot0DataViem[1]),
                lpFee: Number(slot0DataViem[3]) // lpFee is the 4th element (index 3)
            };
        } catch (error) {
            console.error("API Error fetching pool slot0 data:", error);
            return res.status(500).json({ message: "Failed to fetch current pool data.", error });
        }

        // --- Calculate Position (from full_range.ts) ---
        const v4PoolForCalc = new V4Pool(
            sortedToken0,
            sortedToken1,
            slot0.lpFee, 
            DEFAULT_TICK_SPACING,
            ETHERS_ADDRESS_ZERO as `0x${string}`, // hooks not needed for calc
            slot0.sqrtPriceX96,
            JSBI.BigInt(0), // currentLiquidity, not strictly needed for fromAmount0/1
            slot0.tick
        );

        console.log("API LOG: --- Inputs to V4Position Calculation ---");
        console.log("API LOG: Parsed Input Amount (smallest units):", parsedInputAmount.toString());
        console.log("API LOG: Input Token is Token0:", inputTokenIsToken0);
        console.log("API LOG: Is Order Swapped (sortedToken0 vs sdkToken0):", isOrderSwapped);
        console.log("API LOG: Final Tick Lower:", finalTickLower);
        console.log("API LOG: Final Tick Upper:", finalTickUpper);
        console.log("API LOG: v4PoolForCalc details:");
        console.log("API LOG:   sqrtPriceX96:", v4PoolForCalc.sqrtRatioX96.toString());
        console.log("API LOG:   tickCurrent:", v4PoolForCalc.tickCurrent);
        console.log("API LOG:   liquidity (pool):", v4PoolForCalc.liquidity.toString()); // This is 0 as we set it
        console.log("API LOG:   fee (pool, from slot0.lpFee):", v4PoolForCalc.fee);
        console.log("API LOG:   token0 (pool):", v4PoolForCalc.token0.isToken ? v4PoolForCalc.token0.address : 'NativeCurrency', v4PoolForCalc.token0.symbol);
        console.log("API LOG:   token1 (pool):", v4PoolForCalc.token1.isToken ? v4PoolForCalc.token1.address : 'NativeCurrency', v4PoolForCalc.token1.symbol);

        let positionForCalc: V4Position;
        // Determine which token was the input, considering potential sort order swap
        if ((inputTokenIsToken0 && !isOrderSwapped) || (!inputTokenIsToken0 && isOrderSwapped)) {
            // Input token is sortedToken0
            positionForCalc = V4Position.fromAmount0({
                pool: v4PoolForCalc,
                tickLower: finalTickLower,
                tickUpper: finalTickUpper,
                amount0: JSBI.BigInt(parsedInputAmount.toString()), // V4 SDK expects JSBI, parsedInputAmount is bigint
                useFullPrecision: true
            });
        } else {
            // Input token is sortedToken1
            positionForCalc = V4Position.fromAmount1({
                pool: v4PoolForCalc,
                tickLower: finalTickLower,
                tickUpper: finalTickUpper,
                amount1: JSBI.BigInt(parsedInputAmount.toString()) // V4 SDK expects JSBI
            });
        }
        
        const calculatedLiquidity = positionForCalc.liquidity.toString();
        const calculatedAmount0Raw = positionForCalc.mintAmounts.amount0.toString(); // Amount for sortedToken0
        const calculatedAmount1Raw = positionForCalc.mintAmounts.amount1.toString(); // Amount for sortedToken1

        console.log("API LOG: --- Outputs from V4Position Calculation ---");
        console.log("API LOG: Calculated Liquidity (raw):", calculatedLiquidity);
        console.log("API LOG: Calculated Amount0 (sortedToken0, raw):", calculatedAmount0Raw);
        console.log("API LOG: Calculated Amount1 (sortedToken1, raw):", calculatedAmount1Raw);

        const calculatedAmount0BigInt = BigInt(calculatedAmount0Raw); 
        const calculatedAmount1BigInt = BigInt(calculatedAmount1Raw);

        // --- Allowance Checks (Adapting approveTokens logic) ---
        // const permit2Contract = new ethers.Contract(PERMIT2_ADDRESS, iallowance_transfer_abi, provider); // Removed
        const maxUint160BigInt = (1n << 160n) - 1n; // MaxUint160 for Permit2 approval amount
        
        const tokensToPotentiallyApprove = [
            { sdkToken: sortedToken0, requiredAmount: calculatedAmount0BigInt, symbol: TOKEN_DEFINITIONS[sortedToken0.symbol as TokenSymbol]?.symbol || "Token0" },
            { sdkToken: sortedToken1, requiredAmount: calculatedAmount1BigInt, symbol: TOKEN_DEFINITIONS[sortedToken1.symbol as TokenSymbol]?.symbol || "Token1" }
        ];

        for (const tokenInfo of tokensToPotentiallyApprove) {
            if (getAddress(tokenInfo.sdkToken.address) === ETHERS_ADDRESS_ZERO || tokenInfo.requiredAmount === 0n) {
                continue;
            }

            // const erc20Contract = new ethers.Contract(tokenInfo.sdkToken.address, ["function allowance(address owner, address spender) external view returns (uint256)"], provider); // Removed
            
            // 1. Check EOA -> Permit2 allowance for the token
            const eoaToPermit2Allowance = await publicClient.readContract({
                address: getAddress(tokenInfo.sdkToken.address),
                abi: parseAbi(['function allowance(address owner, address spender) external view returns (uint256)']),
                functionName: 'allowance',
                args: [getAddress(userAddress), PERMIT2_ADDRESS]
            }) as bigint;

            if (eoaToPermit2Allowance < tokenInfo.requiredAmount) {
                return res.status(200).json({
                    needsApproval: true,
                    approvalTokenAddress: tokenInfo.sdkToken.address,
                    approvalTokenSymbol: tokenInfo.symbol as TokenSymbol,
                    approveToAddress: PERMIT2_ADDRESS,
                    approvalAmount: maxUint256.toString(), // Request max approval (uint256) from EOA to Permit2
                });
            }

            // 2. Check Permit2 -> PositionManager allowance (Permit2.approve() sets this)
            const permit2SpenderResult = await publicClient.readContract({
                address: PERMIT2_ADDRESS,
                abi: iallowance_transfer_abi, // Already in JSON format
                functionName: 'allowance',
                args: [getAddress(userAddress), getAddress(tokenInfo.sdkToken.address), POSITION_MANAGER_ADDRESS]
            }) as { amount: bigint; expiration: number; nonce: number }; // type matching IAllowanceTransfer output for allowance
            
            // permit2SpenderAllowance.amount is uint160. We check against maxUint160BigInt.
            if (permit2SpenderResult.amount < maxUint160BigInt) { 
                 // Retaining original logic comment:
                 // This implies user needs to call Permit2.approve() via a frontend transaction.
                 // For simplicity in this API, we assume if EOA->Permit2 is good, the user must have done Permit2.approve previously or will do so.
            }
        }

        // --- Prepare Transaction Data (Adapting modifyLiquidity) ---
        const actions = [Liquidity_Actions.MINT_POSITION, Liquidity_Actions.SETTLE_PAIR];
        
        // Equivalent to ethers.utils.solidityPack for these uint8 values
        // encodePacked takes ['uint8', 'uint8', ...], [val1, val2, ...]
        const actionsPackedTypes = actions.map(() => 'uint8' as const); // Corrected to be string array
        const actionsPackedValues = actions.map(a => a); // Values are already numbers
        const actionsEncodedViem = encodePacked(actionsPackedTypes, actionsPackedValues);
        
        // const abiCoder = ethers.utils.defaultAbiCoder; // Removed

        // PoolKey struct for encoding: tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)
        const poolKeyDataForEncode = { 
            currency0: poolKey.currency0 as `0x${string}`,
            currency1: poolKey.currency1 as `0x${string}`,
            fee: poolKey.fee,
            tickSpacing: poolKey.tickSpacing,
            hooks: poolKey.hooks as `0x${string}`
        };

        // const params0Ethers = abiCoder.encode(...); // Old
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
                    name: 'poolKey' // Optional: add a name to the tuple itself for clarity if needed
                }, // PoolKey
                { type: 'int24', name: 'tickLower' },  // Optional: added names for clarity
                { type: 'int24', name: 'tickUpper' },  
                { type: 'uint128', name: 'liquidity' },
                { type: 'uint256', name: 'amount0Desired' },
                { type: 'uint256', name: 'amount1Desired' },
                { type: 'address', name: 'recipient' },
                { type: 'bytes', name: 'data' }    
            ],
            [
                poolKeyDataForEncode, // Pass the object here
                finalTickLower, 
                finalTickUpper, 
                BigInt(calculatedLiquidity), 
                calculatedAmount0BigInt,
                calculatedAmount1BigInt, 
                getAddress(userAddress), 
                '0x' as Hex
            ]
        );
        
        // const params1Ethers = abiCoder.encode(["address", "address"], [sortedToken0.address, sortedToken1.address]); // Old
        const params1Viem = encodeAbiParameters(
            [{ type: 'address' }, { type: 'address' }],
            [getAddress(sortedToken0.address), getAddress(sortedToken1.address)]
        );
        
        const paramsArray = [params0Viem, params1Viem];

        // const positionManagerInterface = new ethers.utils.Interface(position_manager_abi); // Removed
        
        // const latestBlockEthers = await provider.getBlock("latest"); // Old
        const latestBlockViem = await publicClient.getBlock({ blockTag: 'latest' });
        if (!latestBlockViem) throw new Error("Failed to get latest block for deadline.");
        const deadlineBigInt = latestBlockViem.timestamp + 60n; // 60 seconds from now, as BigInt

        // const unlockDataEthers = abiCoder.encode(["bytes", "bytes[]"], [actionsEncodedEthers, paramsArray]); // Old
        const unlockDataViem = encodeAbiParameters(
            [{ type: 'bytes' }, { type: 'bytes[]' }],
            [actionsEncodedViem, paramsArray]
        ) as Hex;

        const deadlineArg = deadlineBigInt;

        console.log("API PREPARE_MINT DEBUG: unlockDataViem input to encodeFunctionData:", unlockDataViem);
        console.log("API PREPARE_MINT DEBUG: deadlineArg input to encodeFunctionData:", deadlineArg.toString());

        // const encodedModifyLiquiditiesCallDataEthers = positionManagerInterface.encodeFunctionData("modifyLiquidities", [unlockDataViem, deadlineBigInt]); // Old
        const encodedModifyLiquiditiesCallDataViem = encodeFunctionData({
            abi: position_manager_abi, // Already in JSON format
            functionName: 'modifyLiquidities',
            args: [unlockDataViem, deadlineArg]
        });

        console.log("API PREPARE_MINT DEBUG: Final encoded calldata:", encodedModifyLiquiditiesCallDataViem);

        return res.status(200).json({
            needsApproval: false,
            transaction: {
                to: POSITION_MANAGER_ADDRESS,
                data: encodedModifyLiquiditiesCallDataViem, 
                value: "0"
            },
            deadline: deadlineBigInt.toString(),
            details: {
                token0: { address: sortedToken0.address, symbol: sortedToken0.symbol as TokenSymbol, amount: calculatedAmount0BigInt.toString() },
                token1: { address: sortedToken1.address, symbol: sortedToken1.symbol as TokenSymbol, amount: calculatedAmount1BigInt.toString() },
                liquidity: calculatedLiquidity, // This is still JSBI.toString() from V4 SDK
                finalTickLower,
                finalTickUpper
            }
        });

    } catch (error: any) {
        console.error("API Error in /api/liquidity/prepare-mint-tx:", error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
        // Avoid sending detailed stack in prod for security
        const errorDetails = process.env.NODE_ENV === 'development' && error instanceof Error ? { name: error.name, stack: error.stack, cause: error.cause } : {};
        return res.status(500).json({ message: errorMessage, error: errorDetails });
    }
} 