import type { NextApiRequest, NextApiResponse } from 'next';
import { type Abi, getAddress, keccak256, encodeAbiParameters, parseAbi, formatUnits } from 'viem';
import { createNetworkClient } from '@/lib/viemClient';
import { position_manager_abi } from '@/lib/abis/PositionManager_abi';
import { STATE_VIEW_ABI } from '@/lib/abis/state_view_abi';
import { getPositionManagerAddress, getStateViewAddress, getTokenSymbolByAddress, getToken, getNetworkModeFromRequest } from '@/lib/pools-config';
import { decodePositionInfo, calculateUnclaimedFeesV4 } from '@/lib/liquidity-utils';

const PM_ABI: Abi = position_manager_abi as unknown as Abi;
const Q128 = (1n << 128n);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<
    | { success: true; amount0: string; amount1: string; debug?: any }
    | { success: true; items: Array<{ positionId: string; amount0: string; amount1: string; token0Symbol: string; token1Symbol: string; formattedAmount0?: string; formattedAmount1?: string }> }
    | { success: false; error: string; debug?: any }
  >
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: `Method ${req.method} Not Allowed` });
  }

  // Get network mode from cookies
  const networkMode = getNetworkModeFromRequest(req.headers.cookie);
  const client = createNetworkClient(networkMode);

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as { positionId?: string; positionIds?: string[] };
    const { positionId, positionIds } = body || {};

    // Helper to compute unclaimed fees for a single positionId (existing logic moved inside)
    const computeFor = async (singlePositionId: string) => {
      // tokenId may be embedded like "...-<tokenId>" → normalize
      const tokenIdStr = singlePositionId.includes('-') ? (singlePositionId.split('-').pop() as string) : singlePositionId;
      const tokenId = BigInt(tokenIdStr);

      const pmAddress = getPositionManagerAddress(networkMode);
      const stateView = getStateViewAddress(networkMode);

      // 1) Read poolKey + packed info from PositionManager
      const pmRead = await client.readContract({
        address: pmAddress as `0x${string}`,
        abi: PM_ABI,
        functionName: 'getPoolAndPositionInfo',
        args: [tokenId],
      } as const) as readonly [
        {
          currency0: `0x${string}`;
          currency1: `0x${string}`;
          fee: number;
          tickSpacing: number;
          hooks: `0x${string}`;
        },
        bigint
      ];

      const poolKey = pmRead[0];
      const infoPacked = pmRead[1];

      // Prefer parsing from positionId (subgraph-style id):
      let parsedOwner: `0x${string}` | null = null;
      let parsedTickLower: number | null = null;
      let parsedTickUpper: number | null = null;
      let parsedSalt: `0x${string}` | null = null;
      const idMatch = singlePositionId.match(/^(0x[0-9a-fA-F]{64})-(0x[0-9a-fA-F]{40})-(-?\d+)-(-?\d+)-(0x[0-9a-fA-F]{64})$/);
      let poolIdBytes32: `0x${string}` | null = null;
      if (idMatch) {
        poolIdBytes32 = idMatch[1] as `0x${string}`;
        parsedOwner = idMatch[2] as `0x${string}`;
        parsedTickLower = Number(idMatch[3]);
        parsedTickUpper = Number(idMatch[4]);
        parsedSalt = idMatch[5] as `0x${string}`;
      }

      // 2) Compute poolId bytes32 via keccak256(abi.encode(PoolKey))
      const encodedPoolKey = encodeAbiParameters([
        {
          type: 'tuple',
          components: [
            { name: 'currency0', type: 'address' },
            { name: 'currency1', type: 'address' },
            { name: 'fee', type: 'uint24' },
            { name: 'tickSpacing', type: 'int24' },
            { name: 'hooks', type: 'address' },
          ],
        },
      ], [
        {
          currency0: getAddress(poolKey.currency0),
          currency1: getAddress(poolKey.currency1),
          fee: Number(poolKey.fee),
          tickSpacing: Number(poolKey.tickSpacing),
          hooks: getAddress(poolKey.hooks),
        },
      ]);
      const computedPoolId = keccak256(encodedPoolKey);
      if (!poolIdBytes32) poolIdBytes32 = computedPoolId as `0x${string}`;

      // Resolve effective owner & ticks (prefer parsed; else decode packed)
      const decoded = decodePositionInfo(infoPacked);
      const effTickLower = parsedTickLower ?? decoded.tickLower;
      const effTickUpper = parsedTickUpper ?? decoded.tickUpper;
      const effOwner = getPositionManagerAddress(networkMode) as `0x${string}`;
      const salt = (parsedSalt ?? (`0x${tokenId.toString(16).padStart(64, '0')}`)) as `0x${string}`;

      // 3) Read stored position info (liquidity and last fee growth inside)
      const stateViewAbiParsed = parseAbi(STATE_VIEW_ABI);
      const posInfo = await client.readContract({
        address: stateView as `0x${string}`,
        abi: stateViewAbiParsed,
        functionName: 'getPositionInfo',
        args: [poolIdBytes32 as `0x${string}`, effOwner, effTickLower as any, effTickUpper as any, salt],
      } as const) as readonly [bigint, bigint, bigint];

      const liquidity = posInfo[0];
      const feeGrowthInside0LastX128 = posInfo[1];
      const feeGrowthInside1LastX128 = posInfo[2];

      // 4) Read current fee growth inside
      const feeInside = await client.readContract({
        address: stateView as `0x${string}`,
        abi: stateViewAbiParsed,
        functionName: 'getFeeGrowthInside',
        args: [poolIdBytes32 as `0x${string}`, effTickLower as any, effTickUpper as any],
      } as const) as readonly [bigint, bigint];

      const feeGrowthInside0X128 = feeInside[0];
      const feeGrowthInside1X128 = feeInside[1];

      // 5) Compute unclaimed fees
      const { token0Fees: rawAmount0, token1Fees: rawAmount1 } = calculateUnclaimedFeesV4(
        liquidity,
        feeGrowthInside0X128,
        feeGrowthInside1X128,
        feeGrowthInside0LastX128,
        feeGrowthInside1LastX128,
      );

      // 6) Get token symbols
      const token0Symbol = getTokenSymbolByAddress(poolKey.currency0, networkMode);
      const token1Symbol = getTokenSymbolByAddress(poolKey.currency1, networkMode);

      if (!token0Symbol || !token1Symbol) {
        throw new Error(`Unable to identify token symbols from addresses`);
      }

      // 7) Optional formatted (display)
      const token0Config = getToken(token0Symbol, networkMode);
      const token1Config = getToken(token1Symbol, networkMode);

      if (!token0Config || !token1Config) {
        throw new Error(`Token configuration not found for ${token0Symbol} or ${token1Symbol}`);
      }

      const formattedAmount0 = formatUnits(rawAmount0, token0Config.decimals);
      const formattedAmount1 = formatUnits(rawAmount1, token1Config.decimals);

      return {
        positionId: singlePositionId,
        amount0: rawAmount0.toString(),
        amount1: rawAmount1.toString(),
        token0Symbol,
        token1Symbol,
        formattedAmount0,
        formattedAmount1,
      } as const;
    };

    // Batch path with multicall optimization
    if (Array.isArray(positionIds) && positionIds.length > 0) {
      const pmAddress = getPositionManagerAddress(networkMode);
      const stateView = getStateViewAddress(networkMode);
      const stateViewAbiParsed = parseAbi(STATE_VIEW_ABI);

      try {
        const pmCalls = positionIds.map(pid => {
          const tokenIdStr = pid.includes('-') ? pid.split('-').pop()! : pid;
          return {
            address: pmAddress as `0x${string}`,
            abi: PM_ABI,
            functionName: 'getPoolAndPositionInfo',
            args: [BigInt(tokenIdStr)]
          };
        });

        const pmResults = await client.multicall({ contracts: pmCalls });

        const stateViewCalls: Array<{ address: `0x${string}`; abi: any; functionName: string; args: any[] }> = [];
        const positionMetadata: Array<{ positionId: string; poolIdBytes32: `0x${string}`; tickLower: number; tickUpper: number; salt: `0x${string}`; pmResultIndex: number }> = [];

        for (let i = 0; i < positionIds.length; i++) {
          if (!pmResults[i].status || pmResults[i].status === 'failure') continue;

          const pmResult = pmResults[i].result as readonly [any, bigint];
          const poolKey = pmResult[0];
          const infoPacked = pmResult[1];

          const encodedPoolKey = encodeAbiParameters([{
            type: 'tuple',
            components: [
              { name: 'currency0', type: 'address' },
              { name: 'currency1', type: 'address' },
              { name: 'fee', type: 'uint24' },
              { name: 'tickSpacing', type: 'int24' },
              { name: 'hooks', type: 'address' },
            ],
          }], [{
            currency0: getAddress(poolKey.currency0),
            currency1: getAddress(poolKey.currency1),
            fee: Number(poolKey.fee),
            tickSpacing: Number(poolKey.tickSpacing),
            hooks: getAddress(poolKey.hooks),
          }]);
          const poolIdBytes32 = keccak256(encodedPoolKey) as `0x${string}`;

          const { tickLower, tickUpper } = decodePositionInfo(infoPacked);
          const tokenIdStr = positionIds[i].includes('-') ? positionIds[i].split('-').pop()! : positionIds[i];
          const salt = `0x${BigInt(tokenIdStr).toString(16).padStart(64, '0')}` as `0x${string}`;

          positionMetadata.push({ positionId: positionIds[i], poolIdBytes32, tickLower, tickUpper, salt, pmResultIndex: i });

          stateViewCalls.push(
            {
              address: stateView as `0x${string}`,
              abi: stateViewAbiParsed,
              functionName: 'getPositionInfo',
              args: [poolIdBytes32, pmAddress as `0x${string}`, tickLower, tickUpper, salt]
            },
            {
              address: stateView as `0x${string}`,
              abi: stateViewAbiParsed,
              functionName: 'getFeeGrowthInside',
              args: [poolIdBytes32, tickLower, tickUpper]
            }
          );
        }

        const stateResults = await client.multicall({ contracts: stateViewCalls });

        const items: Array<{ positionId: string; amount0: string; amount1: string; token0Symbol: string; token1Symbol: string; formattedAmount0?: string; formattedAmount1?: string }> = [];

        for (let i = 0; i < positionMetadata.length; i++) {
          try {
            const meta = positionMetadata[i];
            const posInfoResult = stateResults[i * 2];
            const feeInsideResult = stateResults[i * 2 + 1];

            if (posInfoResult.status === 'failure' || feeInsideResult.status === 'failure') continue;

            const posInfo = posInfoResult.result as readonly [bigint, bigint, bigint];
            const feeInside = feeInsideResult.result as readonly [bigint, bigint];

            const { token0Fees: rawAmount0, token1Fees: rawAmount1 } = calculateUnclaimedFeesV4(
              posInfo[0], feeInside[0], feeInside[1], posInfo[1], posInfo[2]
            );

            const pmResult = pmResults[meta.pmResultIndex].result as readonly [any, bigint];
            const poolKey = pmResult[0];

            const token0Symbol = getTokenSymbolByAddress(poolKey.currency0, networkMode) || 'T0';
            const token1Symbol = getTokenSymbolByAddress(poolKey.currency1, networkMode) || 'T1';
            const token0Config = getToken(token0Symbol, networkMode);
            const token1Config = getToken(token1Symbol, networkMode);

            if (!token0Config || !token1Config) continue;

            const formattedAmount0 = formatUnits(rawAmount0, token0Config.decimals);
            const formattedAmount1 = formatUnits(rawAmount1, token1Config.decimals);

            items.push({
              positionId: meta.positionId,
              amount0: rawAmount0.toString(),
              amount1: rawAmount1.toString(),
              token0Symbol,
              token1Symbol,
              formattedAmount0,
              formattedAmount1
            });
          } catch {}
        }

        return res.status(200).json({ success: true, items });
      } catch (e: any) {
        return res.status(500).json({ success: false, error: e?.message || 'Batch fetch failed' });
      }
    }

    // Single path (backward-compat)
    if (!positionId) {
      return res.status(400).json({ success: false, error: 'positionId or positionIds is required' });
    }

    // tokenId may be embedded like "...-<tokenId>" → normalize
    const tokenIdStr = positionId.includes('-') ? (positionId.split('-').pop() as string) : positionId;
    const tokenId = BigInt(tokenIdStr);

    const pmAddress = getPositionManagerAddress(networkMode);
    const stateView = getStateViewAddress(networkMode);

    // 1) Read poolKey + packed info from PositionManager
    const pmRead = await client.readContract({
      address: pmAddress as `0x${string}`,
      abi: PM_ABI,
      functionName: 'getPoolAndPositionInfo',
      args: [tokenId],
    } as const) as readonly [
      {
        currency0: `0x${string}`;
        currency1: `0x${string}`;
        fee: number;
        tickSpacing: number;
        hooks: `0x${string}`;
      },
      bigint
    ];

    const poolKey = pmRead[0];
    const infoPacked = pmRead[1];

    // Prefer parsing from positionId (subgraph-style id):
    // <poolId>-<owner>-<tickLower>-<tickUpper>-<salt>
    let parsedOwner: `0x${string}` | null = null;
    let parsedTickLower: number | null = null;
    let parsedTickUpper: number | null = null;
    let parsedSalt: `0x${string}` | null = null;
    const idMatch = positionId.match(/^(0x[0-9a-fA-F]{64})-(0x[0-9a-fA-F]{40})-(-?\d+)-(-?\d+)-(0x[0-9a-fA-F]{64})$/);
    let poolIdBytes32: `0x${string}` | null = null;
    if (idMatch) {
      poolIdBytes32 = idMatch[1] as `0x${string}`;
      parsedOwner = idMatch[2] as `0x${string}`;
      parsedTickLower = Number(idMatch[3]);
      parsedTickUpper = Number(idMatch[4]);
      parsedSalt = idMatch[5] as `0x${string}`;
    }

    // 2) Compute poolId bytes32 via keccak256(abi.encode(PoolKey)) to avoid SDK import in API
    const encodedPoolKey = encodeAbiParameters([
      {
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
    ], [
      {
        currency0: getAddress(poolKey.currency0),
        currency1: getAddress(poolKey.currency1),
        fee: Number(poolKey.fee),
        tickSpacing: Number(poolKey.tickSpacing),
        hooks: getAddress(poolKey.hooks),
      },
    ]);
    const computedPoolId = keccak256(encodedPoolKey);
    if (!poolIdBytes32) poolIdBytes32 = computedPoolId as `0x${string}`;

    // Resolve effective owner & ticks (prefer parsed; else decode packed info per v4 spec)
    const decoded = decodePositionInfo(infoPacked);
    const effTickLower = parsedTickLower ?? decoded.tickLower;
    const effTickUpper = parsedTickUpper ?? decoded.tickUpper;
    // In v4 PM, the on-pool owner is the PositionManager, not the user. Use pmAddress.
    const effOwner = pmAddress as `0x${string}`;

    // salt prefer parsed, else tokenId as bytes32
    const salt = (parsedSalt ?? (`0x${tokenId.toString(16).padStart(64, '0')}`)) as `0x${string}`;

    // 3) Read stored position info (liquidity and last fee growth inside)
    const stateViewAbiParsed = parseAbi(STATE_VIEW_ABI);
    const posInfo = await client.readContract({
      address: stateView as `0x${string}`,
      abi: stateViewAbiParsed,
      functionName: 'getPositionInfo',
      args: [poolIdBytes32 as `0x${string}`, effOwner, effTickLower as any, effTickUpper as any, salt],
    } as const) as readonly [bigint, bigint, bigint];

    const liquidity = posInfo[0];
    const feeGrowthInside0LastX128 = posInfo[1];
    const feeGrowthInside1LastX128 = posInfo[2];

    // 4) Read current fee growth inside
    const feeInside = await client.readContract({
      address: stateView as `0x${string}`,
      abi: stateViewAbiParsed,
      functionName: 'getFeeGrowthInside',
      args: [poolIdBytes32 as `0x${string}`, effTickLower as any, effTickUpper as any],
    } as const) as readonly [bigint, bigint];

    const feeGrowthInside0X128 = feeInside[0];
    const feeGrowthInside1X128 = feeInside[1];

    // 5) Compute unclaimed fees (use shared helper for consistency with guide)
    const { token0Fees: rawAmount0, token1Fees: rawAmount1 } = calculateUnclaimedFeesV4(
      liquidity,
      feeGrowthInside0X128,
      feeGrowthInside1X128,
      feeGrowthInside0LastX128,
      feeGrowthInside1LastX128,
    );

    // 6) Get token symbols and format amounts with proper decimals
    const token0Symbol = getTokenSymbolByAddress(poolKey.currency0, networkMode);
    const token1Symbol = getTokenSymbolByAddress(poolKey.currency1, networkMode);

    if (!token0Symbol || !token1Symbol) {
      return res.status(400).json({
        success: false,
        error: 'Unable to identify token symbols from addresses',
        debug: { token0Address: poolKey.currency0, token1Address: poolKey.currency1 }
      });
    }

    // Import token config to get decimals
    const token0Config = getToken(token0Symbol, networkMode);
    const token1Config = getToken(token1Symbol, networkMode);

    if (!token0Config || !token1Config) {
      return res.status(400).json({
        success: false,
        error: 'Unable to get token configurations',
        debug: { token0Symbol, token1Symbol }
      });
    }

    // Convert raw amounts to human-readable format using viem formatUnits (like TokenSelector.tsx)
    const formatTokenDisplayAmount = (rawAmount: bigint, decimals: number, displayDecimals: number) => {
      if (rawAmount === 0n) return "0.00";

      // Use viem's formatUnits to convert from smallest units to human-readable (like TokenSelector.tsx)
      const humanReadableAmount = formatUnits(rawAmount, decimals);
      const numericAmount = parseFloat(humanReadableAmount);

      if (numericAmount === 0) return "0.00";
      if (numericAmount > 0 && numericAmount < 0.001) return "< 0.001";

      // Use displayDecimals from pools.json for final formatting (like TokenSelector.tsx)
      return numericAmount.toFixed(displayDecimals);
    };

    const formattedAmount0 = formatTokenDisplayAmount(rawAmount0, token0Config.decimals, 6);
    const formattedAmount1 = formatTokenDisplayAmount(rawAmount1, token1Config.decimals, 6);

    return res.status(200).json({
      success: true,
      amount0: rawAmount0.toString(),
      amount1: rawAmount1.toString(),
      debug: {
        formattedAmount0,
        formattedAmount1,
        token0Symbol,
        token1Symbol,
        poolKey,
        tickLower: effTickLower,
        tickUpper: effTickUpper,
        poolId: poolIdBytes32,
        owner: effOwner,
        liquidity: liquidity.toString(),
        feeGrowthInside0LastX128: feeGrowthInside0LastX128.toString(),
        feeGrowthInside1LastX128: feeGrowthInside1LastX128.toString(),
        feeGrowthInside0X128: feeGrowthInside0X128.toString(),
        feeGrowthInside1X128: feeGrowthInside1X128.toString(),
        rawAmount0: rawAmount0.toString(),
        rawAmount1: rawAmount1.toString(),
        token0Decimals: token0Config.decimals,
        token1Decimals: token1Config.decimals,
        token0DisplayDecimals: 6,
        token1DisplayDecimals: 6,
      }
    });
  } catch (e: any) {
    return res.status(200).json({ success: false, error: e?.message || 'Failed to compute fees', debug: { stack: e?.stack } });
  }
}


