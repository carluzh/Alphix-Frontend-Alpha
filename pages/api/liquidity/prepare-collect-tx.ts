import type { NextApiRequest, NextApiResponse } from 'next';
import { isAddress, getAddress } from 'viem';

import { getPositionManagerAddress, getNetworkModeFromRequest } from '@/lib/pools-config';
import { validateChainId, checkTxRateLimit } from '@/lib/tx-validation';
import { buildCollectFeesTx, type BuildDecreaseTxContext } from '@/lib/liquidity/transaction/builders/buildDecreaseTx';

interface PrepareCollectTxRequest extends NextApiRequest {
  body: {
    userAddress: string;
    tokenId: string;
    chainId: number;
  };
}

interface CollectTxResponse {
  to: string;
  data: string;
  value: string;
}

interface ErrorResponse {
  error?: string;
  message?: string;
}

export default async function handler(
  req: PrepareCollectTxRequest,
  res: NextApiResponse<CollectTxResponse | ErrorResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { userAddress, tokenId, chainId } = req.body;

    // Get network mode from cookies for proper chain-specific addresses
    const networkMode = getNetworkModeFromRequest(req.headers.cookie);

    // Check rate limit using client IP
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket?.remoteAddress
      || 'unknown';
    const rateCheck = checkTxRateLimit(clientIp);
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', String(rateCheck.retryAfter || 60));
      return res.status(429).json({ message: 'Too many requests. Please try again later.' });
    }

    // Validate inputs
    if (!userAddress || !isAddress(userAddress)) {
      return res.status(400).json({ message: 'Invalid userAddress' });
    }

    if (!tokenId) {
      return res.status(400).json({ message: 'Missing tokenId' });
    }

    if (!chainId) {
      return res.status(400).json({ message: 'Missing chainId' });
    }

    // Validate chain ID
    const chainIdError = validateChainId(chainId, networkMode);
    if (chainIdError) {
      return res.status(400).json({ message: chainIdError });
    }

    // Build context
    const context: BuildDecreaseTxContext = {
      accountAddress: getAddress(userAddress),
      chainId,
      networkMode,
    };

    // Build collect fees transaction
    const txResult = await buildCollectFeesTx(tokenId, context);

    // Get position manager address
    const positionManagerAddress = getPositionManagerAddress(networkMode);

    return res.status(200).json({
      to: positionManagerAddress,
      data: txResult.calldata,
      value: txResult.value.toString(),
    });
  } catch (error: any) {
    console.error('[prepare-collect-tx] Error:', error);
    return res.status(500).json({
      error: 'Failed to prepare collect transaction',
      message: error?.message || 'Unknown error',
    });
  }
}
