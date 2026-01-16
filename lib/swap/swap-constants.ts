import { getAddress, parseAbi, type Address, type Chain, type Abi } from 'viem';
import { position_manager_abi } from '@/lib/abis/PositionManager_abi';
import { MAINNET_CHAIN_ID, TESTNET_CHAIN_ID } from '@/lib/network-mode';
import {
  getChainId,
  getChainName,
  getTokenDefinitions,
  getPositionManagerAddress,
  getHooksAddress,
  type TokenDefinitions,
} from '@/lib/pools-config';

// --- Blockchain & Network Configuration ---
// These are now imported from pools-config.ts which reads from pools.json
export const CHAIN_ID = getChainId();
export const CHAIN_NAME = getChainName();
export const NATIVE_CURRENCY_NAME = 'Ether';
export const NATIVE_CURRENCY_SYMBOL = 'ETH';
export const NATIVE_CURRENCY_DECIMALS = 18;

// --- Contract Addresses ---
export const PERMIT2_ADDRESS_RAW = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
export const PERMIT2_ADDRESS: Address = getAddress(PERMIT2_ADDRESS_RAW);

// --- TOKEN DEFINITIONS ---
// Now imported from pools-config.ts which reads from pools.json
// Use getTokenDefinitions() for dynamic network support
export const TOKEN_DEFINITIONS = getTokenDefinitions();

// Re-export types for backwards compatibility
export type { TokenDefinitions };
export type TokenSymbol = string;

// Explicitly define the type for a single token definition
export interface TokenDefinition {
    readonly addressRaw: string;
    readonly decimals: number;
    readonly symbol: string;
}

// --- V4 Pool Configuration ---
// Note: Fee and tick spacing vary per pool - use pool config for specific values
// These are kept as defaults for legacy compatibility
export const V4_POOL_FEE = 8388608; // Dynamic fee flag (0x800000)
export const V4_POOL_TICK_SPACING = 1; // Default, varies per pool

// Hooks address - imported from pools-config.ts which reads from pools.json
export const V4_POOL_HOOKS: Address = getHooksAddress();
export const V4_POOL_HOOKS_RAW = V4_POOL_HOOKS;

// Permit2 expiration durations - matching Uniswap's approach
export const PERMIT_EXPIRATION_DURATION_SECONDS = 60 * 60 * 24 * 30; // 30 days for on-chain permit
export const PERMIT_SIG_DEADLINE_DURATION_SECONDS = 60 * 30; // 30 minutes for signature deadline
export const TX_DEADLINE_SECONDS = 60 * 30; // 30 minutes for transaction deadline

// Block time constants for time buffer calculations
export const AVERAGE_L1_BLOCK_TIME_MS = 12000; // 12 seconds for Ethereum L1
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
export const UNIVERSAL_ROUTER_ABI_STRINGS = [
  "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable",
  "function execute(bytes commands, bytes[] inputs) payable"
] as const;
export const UniversalRouterAbi: Abi = parseAbi(UNIVERSAL_ROUTER_ABI_STRINGS);

export const PERMIT2_ABI_ALLOWANCE_STRINGS = [
  "function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)"
] as const;
export const Permit2Abi_allowance: Abi = parseAbi(PERMIT2_ABI_ALLOWANCE_STRINGS);

export const ERC20_ABI_STRINGS = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) nonpayable returns (bool)"
] as const;
export const Erc20AbiDefinition: Abi = parseAbi(ERC20_ABI_STRINGS);

// --- Target Chain Definition (for viem clients) ---
// This can be used by a shared publicClient instance.
// RPC_URL will need to be sourced from environment variables where this is used.
export const getTargetChain = (rpcUrl: string) => ({
    id: CHAIN_ID,
    name: CHAIN_NAME,
    nativeCurrency: {
        name: NATIVE_CURRENCY_NAME,
        symbol: NATIVE_CURRENCY_SYMBOL,
        decimals: NATIVE_CURRENCY_DECIMALS
    },
    rpcUrls: {
        default: { http: [rpcUrl] },
        public: { http: [rpcUrl] }
    },
} as const satisfies Chain);

// --- V4 Position Manager Configuration ---
// Now imported from pools-config.ts which reads from pools.json
export const V4_POSITION_MANAGER_ADDRESS: Address = getPositionManagerAddress();
export const V4_POSITION_MANAGER_ADDRESS_RAW = V4_POSITION_MANAGER_ADDRESS;

// --- V4 Quoter Configuration ---
// Use pools-config.getQuoterAddress() instead of hardcoding here

// Empty bytes constant for hook data
// Uniswap SDK ref: sdks/v4-sdk/src/internalConstants.ts:11 → EMPTY_BYTES = '0x'
export const EMPTY_BYTES = '0x' as const;
export const V4_POSITION_MANAGER_ABI = position_manager_abi;

// --- V4 Quoter ABI ---
// Based on Uniswap V4 documentation: https://docs.uniswap.org/contracts/v4/reference/periphery/lens/V4Quoter
// QuoteExactSingleParams struct: { poolKey: { currency0, currency1, fee, tickSpacing, hooks }, zeroForOne, exactAmount, hookData }
// QuoteExactParams struct: { currencyIn, path: PathKey[], amountIn }
// PathKey struct: { intermediateCurrency, fee, tickSpacing, hooks, hookData }
export const V4_QUOTER_ABI_STRINGS = [
  "function quoteExactInputSingle(((address,address,uint24,int24,address),bool,uint128,bytes)) external returns (uint256 amountOut, uint256 gasEstimate)",
  "function quoteExactOutputSingle(((address,address,uint24,int24,address),bool,uint128,bytes)) external returns (uint256 amountIn, uint256 gasEstimate)",
  "function quoteExactInput((address,(address,uint24,int24,address,bytes)[],uint128)) external returns (uint256 amountOut, uint256 gasEstimate)",
  "function quoteExactOutput((address,(address,uint24,int24,address,bytes)[],uint128)) external returns (uint256 amountIn, uint256 gasEstimate)"
] as const;
export const V4QuoterAbi: Abi = parseAbi(V4_QUOTER_ABI_STRINGS);
