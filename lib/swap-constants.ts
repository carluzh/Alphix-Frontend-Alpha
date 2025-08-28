import { getAddress, parseAbi, type Address, type Hex, type Chain, type Abi } from 'viem';
import { position_manager_abi } from './abis/PositionManager_abi';

// --- Blockchain & Network Configuration ---
export const CHAIN_ID = 84532; // Base Sepolia
export const CHAIN_NAME = 'Base Sepolia';
export const NATIVE_CURRENCY_NAME = 'Ether';
export const NATIVE_CURRENCY_SYMBOL = 'ETH';
export const NATIVE_CURRENCY_DECIMALS = 18;

// --- Contract Addresses ---
export const PERMIT2_ADDRESS_RAW = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
export const PERMIT2_ADDRESS: Address = getAddress(PERMIT2_ADDRESS_RAW);

// --- TOKEN DEFINITIONS ---
export const TOKEN_DEFINITIONS = {
    'aUSDC': {
        addressRaw: '0x663cf82e49419a3dc88eec65c2155b4b2d0fa335',
        decimals: 6,
        symbol: 'aUSDC',
        displayDecimals: 2
    },
    'aUSDT': {
        addressRaw: '0xbaabfa3ac2ed3d0154e9e2002f94d8550a79bfa8',
        decimals: 6,
        symbol: 'aUSDT',
        displayDecimals: 2
    },
    'aETH': {
        addressRaw: '0x28c00749cb9066d240fe1270b6d7f294b8b34d99',
        decimals: 18,
        symbol: 'aETH',
        displayDecimals: 4
    },
    'aBTC': {
        addressRaw: '0x13c26fb69d48ed5a72ce3302fc795082e2427f4d',
        decimals: 8,
        symbol: 'aBTC',
        displayDecimals: 6
    },
    'ETH': {
        addressRaw: '0x0000000000000000000000000000000000000000',
        decimals: 18,
        symbol: 'ETH',
        displayDecimals: 4
    }
} as const;

// Define a type for the token symbols for better type safety
export type TokenSymbol = keyof typeof TOKEN_DEFINITIONS;

// Explicitly define the type for a single token definition including displayDecimals
export interface TokenDefinition {
    readonly addressRaw: string;
    readonly decimals: number;
    readonly symbol: TokenSymbol;
    readonly displayDecimals?: number; // Optional, as it's newly added
}

// --- V4 Pool Configuration ---
export const V4_POOL_FEE = 2000; // Updated to match new fee from pools.json
export const V4_POOL_TICK_SPACING = 60;
export const V4_POOL_HOOKS_RAW = '0xd450f7f8e4C11EE8620a349f73e7aC3905Dfd000';
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

// --- V4 Quoter Configuration ---
// Use pools-config.getQuoterAddress() instead of hardcoding here

// Empty bytes constant for hook data
export const EMPTY_BYTES = '0x00' as const;
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
