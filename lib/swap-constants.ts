import { getAddress, parseAbi, type Address, type Hex, type Chain, type Abi } from 'viem';
import { position_manager_abi } from './abis/PositionManager_abi';

// Import from centralized configuration
import { 
  NETWORK_CONFIG, 
  CONTRACT_ADDRESSES, 
  TOKENS, 
  POOLS,
  TIMING,
  type TokenSymbol,
  type TokenDefinition as NewTokenDefinition
} from './pools-config';

// --- Re-export Network Configuration (for backwards compatibility) ---
export const CHAIN_ID = NETWORK_CONFIG.CHAIN_ID;
export const CHAIN_NAME = NETWORK_CONFIG.CHAIN_NAME;
export const NATIVE_CURRENCY_NAME = NETWORK_CONFIG.NATIVE_CURRENCY.name;
export const NATIVE_CURRENCY_SYMBOL = NETWORK_CONFIG.NATIVE_CURRENCY.symbol;
export const NATIVE_CURRENCY_DECIMALS = NETWORK_CONFIG.NATIVE_CURRENCY.decimals;

// --- Re-export Contract Addresses (for backwards compatibility) ---
export const PERMIT2_ADDRESS_RAW = CONTRACT_ADDRESSES.PERMIT2.toLowerCase();
export const UNIVERSAL_ROUTER_ADDRESS_RAW = CONTRACT_ADDRESSES.UNIVERSAL_ROUTER.toLowerCase();
export const PERMIT2_ADDRESS: Address = CONTRACT_ADDRESSES.PERMIT2;
export const UNIVERSAL_ROUTER_ADDRESS: Address = CONTRACT_ADDRESSES.UNIVERSAL_ROUTER;

// --- Re-export Token Definitions (for backwards compatibility) ---
// Convert new format to old format for existing code
export const TOKEN_DEFINITIONS = Object.fromEntries(
  Object.entries(TOKENS).map(([key, token]) => [
    key,
    {
      addressRaw: token.address.toLowerCase(),
      decimals: token.decimals,
      symbol: token.symbol,
      displayDecimals: token.displayDecimals
    }
  ])
) as Record<string, {
  readonly addressRaw: string;
  readonly decimals: number;
  readonly symbol: string;
  readonly displayDecimals: number;
}>;

// Keep the old TokenSymbol type for backwards compatibility
export type { TokenSymbol };

// Legacy TokenDefinition interface for backwards compatibility
export interface TokenDefinition {
    readonly addressRaw: string;
    readonly decimals: number;
    readonly symbol: TokenSymbol;
    readonly displayDecimals?: number;
}

// --- Re-export V4 Pool Configuration (for backwards compatibility) ---
// Use the first pool as the default for legacy constants
const defaultPool = POOLS['yusdc-btcrl'];
export const V4_POOL_FEE = defaultPool.fee;
export const V4_POOL_TICK_SPACING = defaultPool.tickSpacing;
export const V4_POOL_HOOKS_RAW = defaultPool.hooks.toLowerCase();
export const V4_POOL_HOOKS: Address = defaultPool.hooks;

// --- Re-export Timing Constants (for backwards compatibility) ---
export const PERMIT_EXPIRATION_DURATION_SECONDS = TIMING.PERMIT_EXPIRATION_DURATION_SECONDS;
export const PERMIT_SIG_DEADLINE_DURATION_SECONDS = TIMING.PERMIT_SIG_DEADLINE_DURATION_SECONDS;
export const TX_DEADLINE_SECONDS = TIMING.TX_DEADLINE_SECONDS;

// --- EIP-712 Permit2 Domain and Types ---
// The domain will be constructed in the API route if chainId can vary.
// For now, if CHAIN_ID is constant here, this is usable.
export const getPermit2Domain = (chainId: number, verifyingContract: Address) => ({
    name: "Permit2",
    chainId: chainId,
    verifyingContract: verifyingContract,
} as const);

export const PERMIT2_DOMAIN_NAME = "Permit2"; // Used if constructing domain dynamically

export const PERMIT_TYPES = {
    PermitDetails: [
        { name: 'token', type: 'address' }, { name: 'amount', type: 'uint160' },
        { name: 'expiration', type: 'uint48' }, { name: 'nonce', type: 'uint48' },
    ],
    PermitSingle: [
        { name: 'details', type: 'PermitDetails' }, { name: 'spender', type: 'address' },
        { name: 'sigDeadline', type: 'uint256' },
    ],
    PermitBatch: [
        { name: 'details', type: 'PermitDetails[]' }, { name: 'spender', type: 'address' },
        { name: 'sigDeadline', type: 'uint256' },
    ],
} as const;

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
// These constants are needed for the burn liquidity functionality
export const V4_POSITION_MANAGER_ADDRESS_RAW = '0x4b2c77d209d3405f41a037ec6c77f7f5b8e2ca80'; // TODO: Replace with actual address
export const V4_POSITION_MANAGER_ADDRESS: Address = getAddress(V4_POSITION_MANAGER_ADDRESS_RAW);

// Empty bytes constant for hook data
export const EMPTY_BYTES = '0x' as const;
export const V4_POSITION_MANAGER_ABI = position_manager_abi;
