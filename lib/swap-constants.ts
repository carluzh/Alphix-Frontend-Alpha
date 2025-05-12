import { getAddress, parseAbi, type Address, type Hex, type Chain, type Abi } from 'viem';

// --- Blockchain & Network Configuration ---
export const CHAIN_ID = 1301; // Unichain Sepolia
export const CHAIN_NAME = 'Unichain Sepolia';
export const NATIVE_CURRENCY_NAME = 'Unichain Coin';
export const NATIVE_CURRENCY_SYMBOL = 'ETH';
export const NATIVE_CURRENCY_DECIMALS = 18;

// --- Contract Addresses ---
export const PERMIT2_ADDRESS_RAW = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
export const UNIVERSAL_ROUTER_ADDRESS_RAW = '0xf70536b3bcc1bd1a972dc186a2cf84cc6da6be5d';
export const PERMIT2_ADDRESS: Address = getAddress(PERMIT2_ADDRESS_RAW);
export const UNIVERSAL_ROUTER_ADDRESS: Address = getAddress(UNIVERSAL_ROUTER_ADDRESS_RAW);

// --- TOKEN DEFINITIONS ---
export const TOKEN_DEFINITIONS = {
    'YUSDC': {
        addressRaw: '0x4A8595C45DCBe80Da0e0952E97E6F86a020182d7',
        decimals: 6,
        symbol: 'YUSDC'
    },
    'BTCRL': {
        addressRaw: '0x68CD619F8732B294BD23aff270ec8E0F4c22331C',
        decimals: 8,
        symbol: 'BTCRL'
    }
} as const;

// Define a type for the token symbols for better type safety
export type TokenSymbol = keyof typeof TOKEN_DEFINITIONS;

// --- V4 Pool Configuration ---
export const V4_POOL_FEE = 3000;
export const V4_POOL_TICK_SPACING = 60;
export const V4_POOL_HOOKS_RAW = '0xb853E4747E3118dE8C3eD2C47F6Ce1198cF24AC0';
export const V4_POOL_HOOKS: Address = getAddress(V4_POOL_HOOKS_RAW);

// --- Timing Constants (in seconds) ---
// These might be more dynamic or configured elsewhere in a real app,
// but for now, they can reside here or be determined by API routes.
export const PERMIT_EXPIRATION_DURATION_SECONDS = 60 * 60 * 24 * 30; // 30 days
export const PERMIT_SIG_DEADLINE_DURATION_SECONDS = 60 * 30; // 30 minutes
export const TX_DEADLINE_SECONDS = 60 * 30; // 30 minutes

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