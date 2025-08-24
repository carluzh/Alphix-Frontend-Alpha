import { encodeFunctionData, parseUnits, type Address, type Hex, getAddress, encodeAbiParameters, keccak256 } from 'viem';

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
import { Token, Percent } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position, V4PositionManager, PoolKey } from '@uniswap/v4-sdk';
import { TickMath } from '@uniswap/v3-sdk';
import JSBI from 'jsbi'; // v3-sdk utilities often return JSBI

import { publicClient } from './viemClient'; 
// Removed WETH_TOKEN, USDC_TOKEN from this import as they are not in swap-constants.ts
import { CHAIN_ID as DEFAULT_CHAIN_ID } from './swap-constants';
import { getPositionManagerAddress, getStateViewAddress, getToken as getTokenConfig, getTokenSymbolByAddress } from './pools-config';
import { STATE_VIEW_ABI } from './abis/state_view_abi';
import { parseAbi } from 'viem';
import { position_manager_abi } from './abis/PositionManager_abi';
import type { Abi } from 'viem';
import { PERMIT2_ADDRESS, PERMIT2_DOMAIN_NAME, Permit2Abi_allowance } from './swap-constants';

// --- Constants (placeholders kept only where required by examples) ---

// --- ABIs (minimal snippets) ---

const IPositionManagerAbi = [
    {
        name: 'mint',
        type: 'function',
        stateMutability: 'payable',
        inputs: [
            {
                type: 'tuple',
                name: 'params',
                components: [
                    { type: 'tuple', name: 'key', components: [
                        { type: 'address', name: 'currency0' },
                        { type: 'address', name: 'currency1' },
                        { type: 'uint24', name: 'fee' },
                        { type: 'int24', name: 'tickSpacing' },
                        { type: 'address', name: 'hooks' },
                    ]},
                    { type: 'int24', name: 'tickLower' },
                    { type: 'int24', name: 'tickUpper' },
                    { type: 'uint128', name: 'liquidity' },
                    { type: 'uint256', name: 'amount0Min' },
                    { type: 'uint256', name: 'amount1Min' },
                    { type: 'address', name: 'recipient' },
                    { type: 'uint256', name: 'deadline' },
                    { type: 'bytes', name: 'data' }, // hook data
                ],
            },
        ],
        outputs: [
            { type: 'uint256', name: 'tokenId' },
            { type: 'uint128', name: 'liquidityActual' },
            { type: 'uint256', name: 'amount0Actual' },
            { type: 'uint256', name: 'amount1Actual' },
        ],
    },
    {
        name: 'decreaseLiquidity',
        type: 'function',
        stateMutability: 'payable',
        inputs: [
            {
                type: 'tuple',
                name: 'params',
                components: [
                    { type: 'uint256', name: 'tokenId' },
                    { type: 'uint128', name: 'liquidity' },
                    { type: 'uint256', name: 'amount0Min' },
                    { type: 'uint256', name: 'amount1Min' },
                    { type: 'uint256', name: 'deadline' },
                ],
            },
        ],
        outputs: [
            { type: 'uint256', name: 'amount0' },
            { type: 'uint256', name: 'amount1' },
        ],
    },
    {
        name: 'collect',
        type: 'function',
        stateMutability: 'payable',
        inputs: [
            {
                type: 'tuple',
                name: 'params',
                components: [
                    { type: 'uint256', name: 'tokenId' },
                    { type: 'address', name: 'recipient' },
                    { type: 'uint128', name: 'amount0CollectMax' },
                    { type: 'uint128', name: 'amount1CollectMax' },
                ],
            },
        ],
        outputs: [
            { type: 'uint256', name: 'amount0' },
            { type: 'uint256', name: 'amount1' },
        ],
    },
] as const;

// Removed placeholder calculateLiquidityFromAmounts and old tx builders (unused)

export interface AddLiquidityParams {
    userAddress: Address;
    token0: Token;
    token1: Token;
    poolFee: number;
    tickSpacing: number;
    hooksAddress: Address;
    tickLower: number;
    tickUpper: number;
    amount0Desired: string; 
    amount1Desired: string; 
    slippageTolerance?: number; 
    deadlineMinutes?: number;   
    sqrtPriceX96?: bigint; 
}

// Removed unused prepareAddLiquidityTx

export interface RemoveLiquidityParams {
    userAddress: Address; 
    tokenId: bigint;
    liquidityToRemove: bigint; 
    amount0MinReturn: bigint;  
    amount1MinReturn: bigint;  
    deadlineMinutes?: number;
}

// Removed unused prepareDecreaseLiquidityTx

export interface CollectLiquidityParams {
    userAddress: Address; 
    tokenId: bigint;
    amount0CollectMax?: bigint; 
    amount1CollectMax?: bigint;
}

const MAX_UINT_128 = (1n << 128n) - 1n;

// Removed unused prepareCollectLiquidityTx

// Position details helpers

export interface DecodedPositionInfo {
    tickLower: number;
    tickUpper: number;
    hasSubscriber: boolean;
}

export function decodePositionInfo(value: bigint): DecodedPositionInfo {
    // Per v4 guide: signed 24-bit ticks; lower at bits [8..31], upper at [32..55]; lowest byte has flags
    const toSigned24 = (raw: number): number => (raw >= 0x800000 ? raw - 0x1000000 : raw);
    const rawLower = Number((value >> 8n) & 0xFFFFFFn);
    const rawUpper = Number((value >> 32n) & 0xFFFFFFn);
    const hasSub = (value & 0xFFn) !== 0n;
    return {
        tickLower: toSigned24(rawLower),
        tickUpper: toSigned24(rawUpper),
        hasSubscriber: hasSub,
    };
}

export interface PositionDetails {
    tokenId: bigint;
    tickLower: number;
    tickUpper: number;
    liquidity: bigint;
    poolKey: {
        currency0: Address;
        currency1: Address;
        fee: number;
        tickSpacing: number;
        hooks: Address;
    };
}

export async function getPositionDetails(tokenId: bigint): Promise<PositionDetails> {
    const pmAddress = getPositionManagerAddress() as Address;
    const pmAbi: Abi = position_manager_abi as unknown as Abi;

    const [poolKey, infoValue] = (await publicClient.readContract({
        address: pmAddress,
        abi: pmAbi,
        functionName: 'getPoolAndPositionInfo',
        args: [tokenId],
    })) as readonly [
        {
            currency0: Address;
            currency1: Address;
            fee: number;
            tickSpacing: number;
            hooks: Address;
        },
        bigint
    ];

    const liquidity = (await publicClient.readContract({
        address: pmAddress,
        abi: pmAbi,
        functionName: 'getPositionLiquidity',
        args: [tokenId],
    })) as bigint;

    const decoded = decodePositionInfo(infoValue);

    return {
        tokenId,
        tickLower: decoded.tickLower,
        tickUpper: decoded.tickUpper,
        liquidity,
        poolKey,
    };
}

export interface PoolState {
    sqrtPriceX96: bigint;
    tick: number;
    liquidity: bigint;
}

export async function getPoolState(poolId: Hex): Promise<PoolState> {
    const stateViewAddr = getStateViewAddress() as Address;
    // Parse human-readable ABI into viem Abi
    const stateAbi: Abi = parseAbi(STATE_VIEW_ABI as unknown as readonly string[]);

    const [slot0, poolLiquidity] = await Promise.all([
        publicClient.readContract({
            address: stateViewAddr,
            abi: stateAbi,
            functionName: 'getSlot0',
            args: [poolId],
        }) as Promise<readonly [bigint, number, number, number]>,
        publicClient.readContract({
            address: stateViewAddr,
            abi: stateAbi,
            functionName: 'getLiquidity',
            args: [poolId],
        }) as Promise<bigint>,
    ]);

    return {
        sqrtPriceX96: slot0[0],
        tick: Number(slot0[1]),
        liquidity: poolLiquidity,
    };
}

// --- v4 SDK collect fees helper ---

export interface BuildCollectFeesCallParams {
    tokenId: bigint;
    userAddress: Address;
    poolIdHex?: Hex; // optional shortcut if already known (bytes32)
}

export async function buildCollectFeesCall({ tokenId, userAddress }: BuildCollectFeesCallParams): Promise<{ calldata: Hex; value: bigint; pool: V4Pool; position: V4Position }>{
    // Load position details and live pool state
    const details = await getPositionDetails(tokenId);
    // Resolve token metadata (decimals) for building SDK Pool/Position
    const sym0 = getTokenSymbolByAddress(details.poolKey.currency0) || 'T0';
    const sym1 = getTokenSymbolByAddress(details.poolKey.currency1) || 'T1';
    const cfg0 = getTokenConfig(sym0);
    const cfg1 = getTokenConfig(sym1);
    if (!cfg0 || !cfg1) throw new Error('Token configs not found for collect');
    const t0 = new Token(DEFAULT_CHAIN_ID, getAddress(details.poolKey.currency0), cfg0.decimals, sym0);
    const t1 = new Token(DEFAULT_CHAIN_ID, getAddress(details.poolKey.currency1), cfg1.decimals, sym1);

    // Build pool from StateView
    const key: PoolKey = {
        currency0: t0.address as `0x${string}`,
        currency1: t1.address as `0x${string}`,
        fee: details.poolKey.fee,
        tickSpacing: details.poolKey.tickSpacing,
        hooks: details.poolKey.hooks as `0x${string}`,
    } as const;
    // Compute poolId bytes32 locally
    const encodedPoolKey = encodeAbiParameters([
        { type: 'tuple', components: [
            { name: 'currency0', type: 'address' },
            { name: 'currency1', type: 'address' },
            { name: 'fee', type: 'uint24' },
            { name: 'tickSpacing', type: 'int24' },
            { name: 'hooks', type: 'address' },
        ]}
    ], [{
        currency0: key.currency0 as `0x${string}`,
        currency1: key.currency1 as `0x${string}`,
        fee: Number(key.fee),
        tickSpacing: Number(key.tickSpacing),
        hooks: key.hooks as `0x${string}`,
    }]);
    const poolIdBytes32 = keccak256(encodedPoolKey) as Hex;

    let poolState: PoolState;
    try {
        poolState = await getPoolState(poolIdBytes32);
    } catch {
        poolState = { sqrtPriceX96: 0n, tick: details.tickLower, liquidity: 0n };
    }

    const v4Pool = new V4Pool(
        t0,
        t1,
        details.poolKey.fee,
        details.poolKey.tickSpacing,
        details.poolKey.hooks,
        JSBI.BigInt(poolState.sqrtPriceX96.toString()),
        JSBI.BigInt(poolState.liquidity.toString()),
        poolState.tick,
    );

    const position = new V4Position({
        pool: v4Pool,
        tickLower: details.tickLower,
        tickUpper: details.tickUpper,
        liquidity: JSBI.BigInt(details.liquidity.toString()),
    });

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 60);
    const collectOptions = {
        tokenId: tokenId.toString(),
        recipient: getAddress(userAddress) as `0x${string}`,
        slippageTolerance: new Percent(0),
        deadline: deadline.toString(),
        hookData: '0x' as `0x${string}`,
    } as const;

    const { calldata, value } = V4PositionManager.collectCallParameters(position, collectOptions) as { calldata: Hex; value: string | number | bigint };
    return { calldata, value: BigInt(value || 0), pool: v4Pool, position };
}

// --- Permit2 batch permit (EIP-712) preparation per guide ---
// Types schema used for signing (kept local for clarity)
export const PERMIT2_TYPES = {
    PermitDetails: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint160' },
        { name: 'expiration', type: 'uint48' },
        { name: 'nonce', type: 'uint48' },
    ],
    PermitBatch: [
        { name: 'details', type: 'PermitDetails[]' },
        { name: 'spender', type: 'address' },
        { name: 'sigDeadline', type: 'uint256' },
    ],
} as const;

export type Permit2Details = {
    token: Address;
    amount: string; // uint160 as string
    expiration: string; // uint48 as string
    nonce: string; // uint48 as string
};

export type PreparedPermit2Batch = {
    domain: { name: string; chainId: number; verifyingContract: Address };
    types: typeof PERMIT2_TYPES;
    primaryType: 'PermitBatch';
    message: { details: Permit2Details[]; spender: Address; sigDeadline: string };
};

/**
 * Builds EIP-712 Permit2 batch data for PositionManager spending the two pool tokens.
 * Caller should sign with signTypedData and pass signature via v4 options.batchPermit.
 */
export async function preparePermit2BatchForPosition(
    tokenId: bigint,
    userAddress: Address,
    chainId: number,
    sigDeadlineSeconds: number,
): Promise<PreparedPermit2Batch> {
    const pm = getPositionManagerAddress() as Address;
    const details = await getPositionDetails(tokenId);

    const tokens: Address[] = [getAddress(details.poolKey.currency0), getAddress(details.poolKey.currency1)];

    // Query Permit2 allowance tuples to get current nonces
    const detailEntries: Permit2Details[] = [];
    for (const t of tokens) {
        try {
            const allowance = (await publicClient.readContract({
                address: PERMIT2_ADDRESS,
                abi: Permit2Abi_allowance,
                functionName: 'allowance',
                args: [getAddress(userAddress), getAddress(t), getAddress(pm)],
            })) as readonly [bigint, bigint, bigint]; // amount, expiration, nonce

            const nonce = allowance?.[2] ?? 0n;
            detailEntries.push({
                token: getAddress(t),
                amount: (2n ** 160n - 1n).toString(),
                expiration: BigInt(sigDeadlineSeconds).toString(),
                nonce: nonce.toString(),
            });
        } catch {
            // If token is native (no ERC20 at this address) or call fails, skip
        }
    }

    const message = {
        details: detailEntries,
        spender: pm,
        sigDeadline: BigInt(sigDeadlineSeconds).toString(),
    };

    const domain = { name: PERMIT2_DOMAIN_NAME, chainId, verifyingContract: PERMIT2_ADDRESS } as const;

    return {
        domain: domain as unknown as { name: string; chainId: number; verifyingContract: Address },
        types: PERMIT2_TYPES,
        primaryType: 'PermitBatch',
        message,
    };
}

// --- Pure helpers per guide ---
export function calculateUnclaimedFeesV4(
    liquidity: bigint,
    feeGrowthInside0Current: bigint,
    feeGrowthInside1Current: bigint,
    feeGrowthInside0Last: bigint,
    feeGrowthInside1Last: bigint,
) {
    const Q128 = 2n ** 128n;
    // Per v4 FeeMath pattern: subtract modulo 2^256 so accumulator wrap is handled
    const UINT256 = 2n ** 256n;
    const delta0 = (feeGrowthInside0Current - feeGrowthInside0Last + UINT256) % UINT256;
    const delta1 = (feeGrowthInside1Current - feeGrowthInside1Last + UINT256) % UINT256;
    return {
        token0Fees: (delta0 * liquidity) / Q128,
        token1Fees: (delta1 * liquidity) / Q128,
    };
}

export function calculateLifetimeFeesV4(
    liquidity: bigint,
    feeGrowthInside0Current: bigint,
    feeGrowthInside1Current: bigint,
) {
    const Q128 = 2n ** 128n;
    return {
        token0LifetimeFees: (feeGrowthInside0Current * liquidity) / Q128,
        token1LifetimeFees: (feeGrowthInside1Current * liquidity) / Q128,
    };
}

