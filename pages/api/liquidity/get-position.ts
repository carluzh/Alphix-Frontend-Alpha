import type { NextApiRequest, NextApiResponse } from 'next';
import { parseAbi, encodeAbiParameters, keccak256 } from 'viem';
import { getPositionDetails, calculateUnclaimedFeesV4 } from '@/lib/liquidity/liquidity-utils';
import { getNetworkModeFromRequest, getPositionManagerAddress, getStateViewAddress } from '@/lib/pools-config';
import { createNetworkClient } from '@/lib/viemClient';
import { STATE_VIEW_ABI } from '@/lib/abis/state_view_abi';

interface PositionResponse {
  position: {
    tokenId: string;
    owner: string;
    token0: string;
    token1: string;
    fee: number;
    tickLower: number;
    tickUpper: number;
    liquidity: string;
    feeGrowthInside0LastX128: string;
    feeGrowthInside1LastX128: string;
    tokensOwed0: string;
    tokensOwed1: string;
  } | null;
}

interface ErrorResponse {
  error: string;
  message?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PositionResponse | ErrorResponse>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { tokenId } = req.query;

    if (!tokenId || typeof tokenId !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid tokenId' });
    }

    let tokenIdBigInt: bigint;
    try {
      tokenIdBigInt = BigInt(tokenId);
    } catch {
      return res.status(400).json({ error: 'Invalid tokenId format' });
    }

    const networkMode = getNetworkModeFromRequest(req.headers.cookie);
    const chainId = networkMode === 'mainnet' ? 8453 : 84532;
    const client = createNetworkClient(networkMode);
    const positionManager = getPositionManagerAddress(networkMode);

    const [details, owner] = await Promise.all([
      getPositionDetails(tokenIdBigInt, chainId),
      client.readContract({
        address: positionManager as `0x${string}`,
        abi: parseAbi(['function ownerOf(uint256 id) view returns (address)']),
        functionName: 'ownerOf',
        args: [tokenIdBigInt],
      }).catch(() => '' as `0x${string}`),
    ]);

    if (!details || details.liquidity === 0n) {
      return res.status(200).json({ position: null });
    }

    // Calculate uncollected fees
    // Step 1: Compute poolId from poolKey
    const encodedPoolKey = encodeAbiParameters([
      { type: 'tuple', components: [
        { name: 'currency0', type: 'address' },
        { name: 'currency1', type: 'address' },
        { name: 'fee', type: 'uint24' },
        { name: 'tickSpacing', type: 'int24' },
        { name: 'hooks', type: 'address' },
      ]}
    ], [{
      currency0: details.poolKey.currency0 as `0x${string}`,
      currency1: details.poolKey.currency1 as `0x${string}`,
      fee: Number(details.poolKey.fee),
      tickSpacing: Number(details.poolKey.tickSpacing),
      hooks: details.poolKey.hooks as `0x${string}`,
    }]);
    const poolIdBytes32 = keccak256(encodedPoolKey) as `0x${string}`;

    // Step 2: Compute salt from tokenId
    const salt = `0x${tokenIdBigInt.toString(16).padStart(64, '0')}` as `0x${string}`;

    // Step 3: Fetch fee growth data from StateView
    let tokensOwed0 = '0';
    let tokensOwed1 = '0';
    let feeGrowthInside0LastX128 = '0';
    let feeGrowthInside1LastX128 = '0';

    try {
      const stateView = getStateViewAddress(networkMode);
      const stateViewAbi = parseAbi(STATE_VIEW_ABI);

      // Multicall: getPositionInfo + getFeeGrowthInside
      const [posInfoResult, feeInsideResult] = await client.multicall({
        contracts: [
          {
            address: stateView as `0x${string}`,
            abi: stateViewAbi,
            functionName: 'getPositionInfo',
            args: [poolIdBytes32, positionManager as `0x${string}`, details.tickLower, details.tickUpper, salt],
          },
          {
            address: stateView as `0x${string}`,
            abi: stateViewAbi,
            functionName: 'getFeeGrowthInside',
            args: [poolIdBytes32, details.tickLower, details.tickUpper],
          },
        ],
        allowFailure: true,
      });

      if (posInfoResult.status === 'success' && feeInsideResult.status === 'success') {
        const posInfo = posInfoResult.result as readonly [bigint, bigint, bigint];
        const feeInside = feeInsideResult.result as readonly [bigint, bigint];

        // Store fee growth values
        feeGrowthInside0LastX128 = posInfo[1].toString();
        feeGrowthInside1LastX128 = posInfo[2].toString();

        // Calculate unclaimed fees
        const { token0Fees, token1Fees } = calculateUnclaimedFeesV4(
          posInfo[0],      // liquidity
          feeInside[0],    // feeGrowthInside0X128 (current)
          feeInside[1],    // feeGrowthInside1X128 (current)
          posInfo[1],      // feeGrowthInside0LastX128
          posInfo[2],      // feeGrowthInside1LastX128
        );

        tokensOwed0 = token0Fees.toString();
        tokensOwed1 = token1Fees.toString();
      }
    } catch (feeError: any) {
      console.warn('[get-position] Failed to fetch fees:', feeError?.message || feeError);
      // Continue with 0 fees - better than failing the whole request
    }

    return res.status(200).json({
      position: {
        tokenId,
        owner: owner || '',
        token0: details.poolKey.currency0,
        token1: details.poolKey.currency1,
        fee: details.poolKey.fee,
        tickLower: details.tickLower,
        tickUpper: details.tickUpper,
        liquidity: details.liquidity.toString(),
        feeGrowthInside0LastX128,
        feeGrowthInside1LastX128,
        tokensOwed0,
        tokensOwed1,
      },
    });
  } catch (error: any) {
    console.error('[get-position] Error:', error);
    return res.status(500).json({
      error: 'Failed to fetch position',
      message: error?.message || 'Unknown error',
    });
  }
}
