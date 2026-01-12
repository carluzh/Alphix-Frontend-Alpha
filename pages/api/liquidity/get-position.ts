import type { NextApiRequest, NextApiResponse } from 'next';
import { parseAbi } from 'viem';
import { getPositionDetails } from '@/lib/liquidity-utils';
import { getNetworkModeFromRequest, getPositionManagerAddress } from '@/lib/pools-config';
import { createNetworkClient } from '@/lib/viemClient';

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
        feeGrowthInside0LastX128: '0',
        feeGrowthInside1LastX128: '0',
        tokensOwed0: '0',
        tokensOwed1: '0',
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
