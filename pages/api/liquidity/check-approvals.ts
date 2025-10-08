import type { NextApiRequest, NextApiResponse } from 'next';
import { createPublicClient, http, getAddress, parseAbi, parseUnits, maxUint256 } from 'viem';
import { baseSepolia } from 'viem/chains';
import { PERMIT2_ADDRESS, V4_POSITION_MANAGER_ADDRESS, PERMIT2_DOMAIN_NAME } from '@/lib/swap-constants';
import { TOKEN_DEFINITIONS, TokenSymbol, getToken } from '@/lib/pools-config';
import { PERMIT2_TYPES } from '@/lib/liquidity-utils';

const MAX_UINT_160 = (1n << 160n) - 1n;
const PERMIT_EXPIRATION_DURATION_SECONDS = 30 * 24 * 60 * 60; // 30 days
const PERMIT_SIG_DEADLINE_DURATION_SECONDS = 30 * 60; // 30 minutes

interface CheckApprovalsRequest extends NextApiRequest {
  body: {
    userAddress: string;
    token0Symbol: TokenSymbol;
    token1Symbol: TokenSymbol;
    amount0: string;
    amount1: string;
    chainId: number;
  };
}

interface CheckApprovalsResponse {
  // ERC20 approval status
  needsToken0ERC20Approval: boolean;
  needsToken1ERC20Approval: boolean;

  // Permit2 signature status
  needsToken0Permit: boolean;
  needsToken1Permit: boolean;

  // Approval transaction data (if ERC20 approval needed)
  token0ApprovalData?: {
    tokenAddress: string;
    tokenSymbol: TokenSymbol;
    approveToAddress: string;
    approvalAmount: string;
  };
  token1ApprovalData?: {
    tokenAddress: string;
    tokenSymbol: TokenSymbol;
    approveToAddress: string;
    approvalAmount: string;
  };

  // Permit batch data (if permit signature needed)
  permitBatchData?: {
    details: Array<{
      token: string;
      amount: string;
      expiration: string;
      nonce: string;
    }>;
    spender: string;
    sigDeadline: string;
  };

  // EIP-712 signature details (if permit signature needed)
  signatureDetails?: {
    domain: {
      name: string;
      chainId: number;
      verifyingContract: string;
    };
    types: any;
    primaryType: string;
  };

  message?: string;
}

export default async function handler(
  req: CheckApprovalsRequest,
  res: NextApiResponse<CheckApprovalsResponse>
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({
      needsToken0ERC20Approval: true,
      needsToken1ERC20Approval: true,
      needsToken0Permit: true,
      needsToken1Permit: true,
      message: `Method ${req.method} Not Allowed`
    });
  }

  try {
    const {
      userAddress,
      token0Symbol,
      token1Symbol,
      amount0,
      amount1,
      chainId
    } = req.body;

    // Input validation
    if (!userAddress || !chainId) {
      return res.status(400).json({
        needsToken0ERC20Approval: true,
        needsToken1ERC20Approval: true,
        needsToken0Permit: true,
        needsToken1Permit: true,
        message: "User address and chain ID are required"
      });
    }

    const token0Config = getToken(token0Symbol);
    const token1Config = getToken(token1Symbol);

    if (!token0Config || !token1Config) {
      return res.status(400).json({
        needsToken0ERC20Approval: true,
        needsToken1ERC20Approval: true,
        needsToken0Permit: true,
        needsToken1Permit: true,
        message: "Invalid token symbol(s)"
      });
    }

    // Create client for reading chain data
    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http()
    });

    const currentTime = Math.floor(Date.now() / 1000);
    const tokensNeedingPermit: Array<{
      token: string;
      amount: string;
      nonce: string;
    }> = [];

    // Check both tokens
    const tokens = [
      { symbol: token0Symbol, config: token0Config, amount: amount0 },
      { symbol: token1Symbol, config: token1Config, amount: amount1 },
    ];

    let needsToken0ERC20Approval = false;
    let needsToken1ERC20Approval = false;
    let needsToken0Permit = false;
    let needsToken1Permit = false;
    let token0ApprovalData: CheckApprovalsResponse['token0ApprovalData'];
    let token1ApprovalData: CheckApprovalsResponse['token1ApprovalData'];

    for (const [index, { symbol, config, amount }] of tokens.entries()) {
      const isToken0 = index === 0;

      if (parseFloat(amount) <= 0) continue;
      if (config.address === "0x0000000000000000000000000000000000000000") continue; // Skip native ETH

      // Parse the actual required amount for this transaction
      const requiredAmount = parseUnits(amount, config.decimals);

      // Step 1: Check ERC20 allowance to Permit2
      const erc20Allowance = await publicClient.readContract({
        address: getAddress(config.address),
        abi: parseAbi(['function allowance(address owner, address spender) external view returns (uint256)']),
        functionName: 'allowance',
        args: [getAddress(userAddress), PERMIT2_ADDRESS]
      }) as bigint;

      if (erc20Allowance < requiredAmount) {
        // Need ERC20 approval
        if (isToken0) {
          needsToken0ERC20Approval = true;
          token0ApprovalData = {
            tokenAddress: config.address,
            tokenSymbol: symbol,
            approveToAddress: PERMIT2_ADDRESS,
            approvalAmount: maxUint256.toString(),
          };
        } else {
          needsToken1ERC20Approval = true;
          token1ApprovalData = {
            tokenAddress: config.address,
            tokenSymbol: symbol,
            approveToAddress: PERMIT2_ADDRESS,
            approvalAmount: maxUint256.toString(),
          };
        }
        continue; // Skip permit check if ERC20 approval needed first
      }

      // Step 2: Check Permit2 allowance
      const [permitAmount, permitExpiration, permitNonce] = await publicClient.readContract({
        address: PERMIT2_ADDRESS,
        abi: parseAbi(['function allowance(address owner, address token, address spender) external view returns (uint160 amount, uint48 expiration, uint48 nonce)']),
        functionName: 'allowance',
        args: [getAddress(userAddress), getAddress(config.address), V4_POSITION_MANAGER_ADDRESS as `0x${string}`]
      }) as readonly [bigint, number, number];

      const sufficientPermitAmount = permitAmount >= MAX_UINT_160 || permitAmount >= requiredAmount;
      const permitNotExpired = permitExpiration === 0 || permitExpiration > currentTime;

      if (!sufficientPermitAmount || !permitNotExpired) {
        // Need Permit2 signature
        if (isToken0) {
          needsToken0Permit = true;
        } else {
          needsToken1Permit = true;
        }

        tokensNeedingPermit.push({
          token: getAddress(config.address),
          amount: MAX_UINT_160.toString(),
          nonce: permitNonce.toString(),
        });
      }
    }

    // Build response
    const response: CheckApprovalsResponse = {
      needsToken0ERC20Approval,
      needsToken1ERC20Approval,
      needsToken0Permit,
      needsToken1Permit,
      token0ApprovalData,
      token1ApprovalData,
    };

    // If permits are needed, prepare batch permit data
    if (tokensNeedingPermit.length > 0) {
      const expiration = currentTime + PERMIT_EXPIRATION_DURATION_SECONDS;
      const sigDeadline = currentTime + PERMIT_SIG_DEADLINE_DURATION_SECONDS;

      response.permitBatchData = {
        details: tokensNeedingPermit.map(t => ({
          ...t,
          expiration: expiration.toString(),
        })),
        spender: V4_POSITION_MANAGER_ADDRESS,
        sigDeadline: sigDeadline.toString(),
      };

      response.signatureDetails = {
        domain: {
          name: PERMIT2_DOMAIN_NAME,
          chainId,
          verifyingContract: PERMIT2_ADDRESS,
        },
        types: PERMIT2_TYPES,
        primaryType: 'PermitBatch',
      };
    }

    return res.status(200).json(response);
  } catch (error: any) {
    console.error('Error checking approvals:', error);
    return res.status(500).json({
      needsToken0ERC20Approval: true,
      needsToken1ERC20Approval: true,
      needsToken0Permit: true,
      needsToken1Permit: true,
      message: error.message || 'An error occurred while checking approvals'
    });
  }
}
