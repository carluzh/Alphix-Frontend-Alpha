import { type Address, type Hex } from 'viem';

import { createNetworkClient } from '@/lib/viemClient';
import { getPositionManagerAddress, getStateViewAddress } from '@/lib/pools-config';
import { modeForChainId, type NetworkMode } from '@/lib/network-mode';
import { STATE_VIEW_ABI } from '@/lib/abis/state_view_abi';
import { parseAbi } from 'viem';
import { position_manager_abi } from '@/lib/abis/PositionManager_abi';
import type { Abi } from 'viem';

// Position details helpers

interface DecodedPositionInfo {
    tickLower: number;
    tickUpper: number;
    hasSubscriber: boolean;
}

function decodePositionInfo(value: bigint): DecodedPositionInfo {
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

export async function getPositionDetails(tokenId: bigint, chainId: number): Promise<PositionDetails> {
    const networkMode: NetworkMode = modeForChainId(chainId) ?? 'base';
    const publicClient = createNetworkClient(networkMode);
    const pmAddress = getPositionManagerAddress(networkMode) as Address;
    const pmAbi: Abi = position_manager_abi as unknown as Abi;

    // Batch position reads into single multicall
    const [poolAndPositionResult, liquidityResult] = await publicClient.multicall({
        contracts: [
            {
                address: pmAddress,
                abi: pmAbi,
                functionName: 'getPoolAndPositionInfo',
                args: [tokenId],
            },
            {
                address: pmAddress,
                abi: pmAbi,
                functionName: 'getPositionLiquidity',
                args: [tokenId],
            }
        ],
        allowFailure: false,
    });

    const [poolKey, infoValue] = poolAndPositionResult as readonly [
        {
            currency0: Address;
            currency1: Address;
            fee: number;
            tickSpacing: number;
            hooks: Address;
        },
        bigint
    ];
    const liquidity = liquidityResult as bigint;

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

export async function getPoolState(poolId: Hex, chainId: number): Promise<PoolState> {
    const networkMode: NetworkMode = modeForChainId(chainId) ?? 'base';
    const publicClient = createNetworkClient(networkMode);
    const stateViewAddr = getStateViewAddress(networkMode) as Address;
    // Parse human-readable ABI into viem Abi
    const stateAbi: Abi = parseAbi(STATE_VIEW_ABI as unknown as readonly string[]);

    // Batch pool state reads into single multicall
    const [slot0Result, liquidityResult] = await publicClient.multicall({
        contracts: [
            {
                address: stateViewAddr,
                abi: stateAbi,
                functionName: 'getSlot0',
                args: [poolId],
            },
            {
                address: stateViewAddr,
                abi: stateAbi,
                functionName: 'getLiquidity',
                args: [poolId],
            }
        ],
        allowFailure: false,
    });

    const slot0 = slot0Result as readonly [bigint, number, number, number];
    const poolLiquidity = liquidityResult as bigint;

    return {
        sqrtPriceX96: slot0[0],
        tick: Number(slot0[1]),
        liquidity: poolLiquidity,
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

