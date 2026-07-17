import { getAddress, parseAbi, type Address, type Abi } from 'viem';

import { type TokenDefinitions } from '@/lib/pools-config';

// --- Contract Addresses ---
const PERMIT2_ADDRESS_RAW = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
export const PERMIT2_ADDRESS: Address = getAddress(PERMIT2_ADDRESS_RAW);

// Re-export types for backwards compatibility
export type { TokenDefinitions };

// Permit2 expiration durations - matching Uniswap's approach
export const PERMIT_EXPIRATION_DURATION_SECONDS = 60 * 60 * 24 * 30; // 30 days for on-chain permit

export const PERMIT2_DOMAIN_NAME = "Permit2";

export const Permit2Abi_allowance: Abi = parseAbi([
  "function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)"
] as const);
