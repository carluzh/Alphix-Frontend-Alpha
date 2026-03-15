import { type Address, type Hex, getAddress, zeroAddress, encodeAbiParameters, keccak256 } from 'viem';
import { PERMIT2_TYPES } from '@/lib/permit-types';

import { createNetworkClient } from '@/lib/viemClient';
import { getPositionManagerAddress, getStateViewAddress, getToken, getTokenSymbolByAddress } from '@/lib/pools-config';
import { modeForChainId, type NetworkMode } from '@/lib/network-mode';
import { STATE_VIEW_ABI } from '@/lib/abis/state_view_abi';
import { parseAbi } from 'viem';
import { position_manager_abi } from '@/lib/abis/PositionManager_abi';
import type { Abi } from 'viem';
import { PERMIT2_ADDRESS, PERMIT2_DOMAIN_NAME, Permit2Abi_allowance, PERMIT_EXPIRATION_DURATION_SECONDS } from '@/lib/swap/swap-constants';
import { Token, Ether } from '@uniswap/sdk-core';
import { Pool as V4Pool } from '@uniswap/v4-sdk';
import JSBI from 'jsbi';

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

// --- Permit2 batch permit (EIP-712) preparation per guide ---
// PERMIT2_TYPES imported from lib/permit-types.ts (consolidated source)
// Re-export for backwards compatibility with existing imports
export { PERMIT2_TYPES } from '@/lib/permit-types';

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

export async function preparePermit2BatchForPosition(
    tokenId: bigint,
    userAddress: Address,
    chainId: number,
    sigDeadlineSeconds: number,
    amount0?: bigint,
    amount1?: bigint,
): Promise<PreparedPermit2Batch> {
    const networkMode: NetworkMode = modeForChainId(chainId) ?? 'base';
    const publicClient = createNetworkClient(networkMode);
    const pm = getPositionManagerAddress(networkMode) as Address;
    const details = await getPositionDetails(tokenId, chainId);
    const tokens: Address[] = [getAddress(details.poolKey.currency0), getAddress(details.poolKey.currency1)];
    const amounts = [amount0 || 0n, amount1 || 0n];
    const now = Math.floor(Date.now() / 1000);

    // Filter to tokens with non-zero amounts
    const tokensToCheck = tokens
        .map((t, i) => ({ token: t, amount: amounts[i], index: i }))
        .filter(item => item.amount > 0n);

    const detailEntries: Permit2Details[] = [];

    if (tokensToCheck.length > 0) {
        try {
            // Batch all Permit2 allowance checks into single multicall
            const results = await publicClient.multicall({
                contracts: tokensToCheck.map(item => ({
                    address: PERMIT2_ADDRESS,
                    abi: Permit2Abi_allowance,
                    functionName: 'allowance',
                    args: [getAddress(userAddress), getAddress(item.token), getAddress(pm)],
                })),
                allowFailure: false,
            });

            const MAX_UINT160 = BigInt("1461501637330902918203684832716283019655932542975");

            tokensToCheck.forEach((item, i) => {
                const [currentAmount, currentExpiration, nonce] = results[i] as readonly [bigint, bigint, bigint];

                if (currentAmount >= item.amount && currentExpiration > now) return;

                const permitAmount = item.amount + 1n;
                if (permitAmount > MAX_UINT160) {
                    throw new Error(`Permit amount ${permitAmount} exceeds uint160 max. Required: ${item.amount}`);
                }

                detailEntries.push({
                    token: getAddress(item.token),
                    amount: permitAmount.toString(),
                    expiration: (now + PERMIT_EXPIRATION_DURATION_SECONDS).toString(),
                    nonce: nonce.toString(),
                });
            });
        } catch (error) {
            console.error('[preparePermit2BatchForPosition] Permit2 allowance check failed:', error);
            throw new Error(
                `Failed to check Permit2 allowances for position ${tokenId}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    return {
        domain: { name: PERMIT2_DOMAIN_NAME, chainId, verifyingContract: PERMIT2_ADDRESS } as unknown as { name: string; chainId: number; verifyingContract: Address },
        types: PERMIT2_TYPES,
        primaryType: 'PermitBatch',
        message: {
            details: detailEntries,
            spender: pm,
            sigDeadline: BigInt(sigDeadlineSeconds).toString(),
        },
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

// ---------------------------------------------------------------------------
// Build pool + token context from an on-chain position
// ---------------------------------------------------------------------------

export interface PositionPoolContext {
  details: PositionDetails;
  defC0: NonNullable<ReturnType<typeof getToken>>;
  defC1: NonNullable<ReturnType<typeof getToken>>;
  currency0: Token | Ether;
  currency1: Token | Ether;
  isNativeC0: boolean;
  isNativeC1: boolean;
  pool: V4Pool;
  poolState: PoolState;
}

/**
 * Given an NFT tokenId, resolves on-chain position data, token definitions,
 * pool state, and builds a V4Pool — the shared setup that both
 * prepare-decrease-tx and prepare-increase-tx need.
 */
export async function buildPoolFromPosition(
  nftTokenId: bigint,
  chainId: number,
  networkMode: NetworkMode,
): Promise<PositionPoolContext> {
  const details = await getPositionDetails(nftTokenId, chainId);

  const symC0 = getTokenSymbolByAddress(getAddress(details.poolKey.currency0), networkMode);
  const symC1 = getTokenSymbolByAddress(getAddress(details.poolKey.currency1), networkMode);
  if (!symC0 || !symC1) throw new Error('Token symbols not found for pool currencies');

  const defC0 = getToken(symC0, networkMode);
  const defC1 = getToken(symC1, networkMode);
  if (!defC0 || !defC1) throw new Error('Token definitions not found');

  const isNativeC0 = getAddress(details.poolKey.currency0) === zeroAddress;
  const isNativeC1 = getAddress(details.poolKey.currency1) === zeroAddress;
  const currency0 = isNativeC0
    ? Ether.onChain(chainId)
    : new Token(chainId, getAddress(defC0.address), defC0.decimals, defC0.symbol);
  const currency1 = isNativeC1
    ? Ether.onChain(chainId)
    : new Token(chainId, getAddress(defC1.address), defC1.decimals, defC1.symbol);

  const keyTuple = [{
    currency0: getAddress(details.poolKey.currency0),
    currency1: getAddress(details.poolKey.currency1),
    fee: Number(details.poolKey.fee),
    tickSpacing: Number(details.poolKey.tickSpacing),
    hooks: getAddress(details.poolKey.hooks),
  }];
  const encoded = encodeAbiParameters([{
    type: 'tuple',
    components: [
      { name: 'currency0', type: 'address' },
      { name: 'currency1', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'tickSpacing', type: 'int24' },
      { name: 'hooks', type: 'address' },
    ],
  }], keyTuple as any);
  const poolId = keccak256(encoded) as Hex;
  const poolState = await getPoolState(poolId, chainId);

  const pool = new V4Pool(
    currency0 as any,
    currency1,
    details.poolKey.fee,
    details.poolKey.tickSpacing,
    details.poolKey.hooks,
    JSBI.BigInt(poolState.sqrtPriceX96.toString()),
    JSBI.BigInt(poolState.liquidity.toString()),
    poolState.tick,
  );

  return { details, defC0, defC1, currency0, currency1, isNativeC0, isNativeC1, pool, poolState };
}

