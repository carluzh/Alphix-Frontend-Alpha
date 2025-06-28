import type { NextApiRequest, NextApiResponse } from 'next';
import { createPublicClient, http, getAddress, parseAbi } from 'viem';
import { baseSepolia } from 'viem/chains';
import { PERMIT2_ADDRESS, TOKEN_DEFINITIONS } from '@/lib/swap-constants';
import { TokenSymbol } from '@/lib/swap-constants';
import { TOKEN_DEFINITIONS as POOLS_TOKEN_DEFINITIONS } from '@/lib/pools-config';

// Define constants from other files
const POSITION_MANAGER_ADDRESS = getAddress("0x4b2c77d209d3405f41a037ec6c77f7f5b8e2ca80");
const MAX_UINT_160 = (1n << 160n) - 1n;

interface CheckTokenApprovalsRequest extends NextApiRequest {
  body: {
    userAddress: string;
    token0Symbol: TokenSymbol;
    token1Symbol: TokenSymbol;
    amount0: string;
    amount1: string;
    chainId: number;
  };
}

interface CheckTokenApprovalsResponse {
  needsToken0Approval: boolean;
  needsToken1Approval: boolean;
  message?: string;
}

export default async function handler(
  req: CheckTokenApprovalsRequest,
  res: NextApiResponse<CheckTokenApprovalsResponse>
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ 
      needsToken0Approval: true, 
      needsToken1Approval: true,
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
    if (!userAddress) {
      return res.status(400).json({ 
        needsToken0Approval: true, 
        needsToken1Approval: true,
        message: "User address is required" 
      });
    }

    if (!POOLS_TOKEN_DEFINITIONS[token0Symbol] || !POOLS_TOKEN_DEFINITIONS[token1Symbol]) {
      return res.status(400).json({ 
        needsToken0Approval: true, 
        needsToken1Approval: true,
        message: "Invalid token symbol(s)" 
      });
    }

    // Create client for reading chain data
    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http()
    });

    // Default response (assume approvals needed)
    let needsToken0Approval = parseFloat(amount0) > 0;
    let needsToken1Approval = parseFloat(amount1) > 0;

    // Check Token0 if needed
    if (parseFloat(amount0) > 0) {
      const token0Address = POOLS_TOKEN_DEFINITIONS[token0Symbol].addressRaw;
      
      // Step 1: Check ERC20 allowance from User to Permit2
      const eoaToPermit2Erc20Allowance = await publicClient.readContract({
        address: getAddress(token0Address),
        abi: parseAbi(['function allowance(address owner, address spender) external view returns (uint256)']),
        functionName: 'allowance',
        args: [getAddress(userAddress), PERMIT2_ADDRESS]
      }) as bigint;

      const requiredAmount = parseFloat(amount0) * Math.pow(10, POOLS_TOKEN_DEFINITIONS[token0Symbol].decimals);
      const requiredAmountBigInt = BigInt(Math.floor(requiredAmount));

      if (eoaToPermit2Erc20Allowance >= requiredAmountBigInt) {
        // Step 2: Check Permit2 allowance for PositionManager
        const permit2AllowanceTuple = await publicClient.readContract({
          address: PERMIT2_ADDRESS,
          abi: parseAbi(['function allowance(address owner, address token, address spender) external view returns (uint160 amount, uint48 expiration, uint48 nonce)']),
          functionName: 'allowance',
          args: [getAddress(userAddress), getAddress(token0Address), POSITION_MANAGER_ADDRESS]
        }) as readonly [amount: bigint, expiration: number, nonce: number];
        
        const permit2SpenderAmount = permit2AllowanceTuple[0];
        const permit2SpenderExpiration = permit2AllowanceTuple[1];
        const currentTimestamp = Math.floor(Date.now() / 1000);
        
        // Check if the permit amount is sufficient and not expired
        const sufficientAmount = requiredAmountBigInt > MAX_UINT_160 
          ? permit2SpenderAmount >= MAX_UINT_160
          : permit2SpenderAmount >= requiredAmountBigInt;
          
        const notExpired = permit2SpenderExpiration === 0 || permit2SpenderExpiration > currentTimestamp;
        
        // Only set to false if both conditions are met
        if (sufficientAmount && notExpired) {
          needsToken0Approval = false;
        }
      }
    } else {
      // No amount needed, so no approval needed
      needsToken0Approval = false;
    }

    // Check Token1 if needed
    if (parseFloat(amount1) > 0) {
      const token1Address = POOLS_TOKEN_DEFINITIONS[token1Symbol].addressRaw;
      
      // Step 1: Check ERC20 allowance from User to Permit2
      const eoaToPermit2Erc20Allowance = await publicClient.readContract({
        address: getAddress(token1Address),
        abi: parseAbi(['function allowance(address owner, address spender) external view returns (uint256)']),
        functionName: 'allowance',
        args: [getAddress(userAddress), PERMIT2_ADDRESS]
      }) as bigint;

      const requiredAmount = parseFloat(amount1) * Math.pow(10, POOLS_TOKEN_DEFINITIONS[token1Symbol].decimals);
      const requiredAmountBigInt = BigInt(Math.floor(requiredAmount));

      if (eoaToPermit2Erc20Allowance >= requiredAmountBigInt) {
        // Step 2: Check Permit2 allowance for PositionManager
        const permit2AllowanceTuple = await publicClient.readContract({
          address: PERMIT2_ADDRESS,
          abi: parseAbi(['function allowance(address owner, address token, address spender) external view returns (uint160 amount, uint48 expiration, uint48 nonce)']),
          functionName: 'allowance',
          args: [getAddress(userAddress), getAddress(token1Address), POSITION_MANAGER_ADDRESS]
        }) as readonly [amount: bigint, expiration: number, nonce: number];
        
        const permit2SpenderAmount = permit2AllowanceTuple[0];
        const permit2SpenderExpiration = permit2AllowanceTuple[1];
        const currentTimestamp = Math.floor(Date.now() / 1000);
        
        // Check if the permit amount is sufficient and not expired
        const sufficientAmount = requiredAmountBigInt > MAX_UINT_160 
          ? permit2SpenderAmount >= MAX_UINT_160
          : permit2SpenderAmount >= requiredAmountBigInt;
          
        const notExpired = permit2SpenderExpiration === 0 || permit2SpenderExpiration > currentTimestamp;
        
        // Only set to false if both conditions are met
        if (sufficientAmount && notExpired) {
          needsToken1Approval = false;
        }
      }
    } else {
      // No amount needed, so no approval needed
      needsToken1Approval = false;
    }

    return res.status(200).json({
      needsToken0Approval,
      needsToken1Approval
    });
  } catch (error: any) {
    console.error('Error checking token approvals:', error);
    return res.status(500).json({
      needsToken0Approval: true,
      needsToken1Approval: true,
      message: error.message || 'An error occurred while checking token approvals'
    });
  }
} 