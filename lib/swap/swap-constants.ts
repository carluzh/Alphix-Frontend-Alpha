import { getAddress, parseAbi, type Address, type Abi } from 'viem';

import { type TokenDefinitions } from '@/lib/pools-config';

// --- Contract Addresses ---
const PERMIT2_ADDRESS_RAW = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
export const PERMIT2_ADDRESS: Address = getAddress(PERMIT2_ADDRESS_RAW);

// Re-export types for backwards compatibility
export type { TokenDefinitions };

// Permit2 expiration durations - matching Uniswap's approach
export const PERMIT_EXPIRATION_DURATION_SECONDS = 60 * 60 * 24 * 30; // 30 days for on-chain permit
export const PERMIT_SIG_DEADLINE_DURATION_SECONDS = 60 * 30; // 30 minutes for signature deadline
export const TX_DEADLINE_SECONDS = 60 * 30; // 30 minutes for transaction deadline

// Block time constants for time buffer calculations
export const AVERAGE_L2_BLOCK_TIME_MS = 2000; // 2 seconds for Base (L2)

// Max allowance for Permit2 (uint160 max)
export const MaxAllowanceTransferAmount = 2n ** 160n - 1n;

export const getPermit2Domain = (chainId: number, verifyingContract: Address) => ({
    name: "Permit2",
    chainId,
    verifyingContract,
} as const);

export const PERMIT2_DOMAIN_NAME = "Permit2";

// Re-export permit types from consolidated source
// See lib/permit-types.ts for all Permit2 EIP-712 type definitions
export { PERMIT_TYPES, PERMIT_BATCH_TYPES, PERMIT2_TYPES } from '@/lib/permit-types';

// C9: Re-export CommandType for convenient imports
// @see interface/packages/uniswap/src/data/tradingApi/index.ts
export { CommandType } from '@uniswap/universal-router-sdk';

// --- ABI Definitions ---
export const UniversalRouterAbi: Abi = parseAbi([
  "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable",
  "function execute(bytes commands, bytes[] inputs) payable"
] as const);

export const Permit2Abi_allowance: Abi = parseAbi([
  "function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)"
] as const);

export const Erc20AbiDefinition: Abi = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) nonpayable returns (bool)"
] as const);

// Empty bytes constant for hook data
// Uniswap SDK ref: sdks/v4-sdk/src/internalConstants.ts:11 → EMPTY_BYTES = '0x'
export const EMPTY_BYTES = '0x' as const;

// --- V4 Quoter ABI ---
// Based on Uniswap V4 documentation: https://docs.uniswap.org/contracts/v4/reference/periphery/lens/V4Quoter
// QuoteExactSingleParams struct: { poolKey: { currency0, currency1, fee, tickSpacing, hooks }, zeroForOne, exactAmount, hookData }
// QuoteExactParams struct: { currencyIn, path: PathKey[], amountIn }
// PathKey struct: { intermediateCurrency, fee, tickSpacing, hooks, hookData }
export const V4QuoterAbi: Abi = parseAbi([
  "function quoteExactInputSingle(((address,address,uint24,int24,address),bool,uint128,bytes)) external returns (uint256 amountOut, uint256 gasEstimate)",
  "function quoteExactOutputSingle(((address,address,uint24,int24,address),bool,uint128,bytes)) external returns (uint256 amountIn, uint256 gasEstimate)",
  "function quoteExactInput((address,(address,uint24,int24,address,bytes)[],uint128)) external returns (uint256 amountOut, uint256 gasEstimate)",
  "function quoteExactOutput((address,(address,uint24,int24,address,bytes)[],uint128)) external returns (uint256 amountIn, uint256 gasEstimate)"
] as const);
