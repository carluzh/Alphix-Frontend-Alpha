// Minimal schema stub — satisfies v2.4.0 swap-widgets and rpc-client imports of
// `@kyber/schema` without vendoring the full schema package.
// Only fields actually read at runtime by the fork's utils/crypto, rpc-client,
// and use-approval hooks are populated.

export enum ChainId {
  Ethereum = 1,
  Bsc = 56,
  PolygonPos = 137,
  Arbitrum = 42161,
  Avalanche = 43114,
  Base = 8453,
  Blast = 81457,
  Fantom = 250,
  Linea = 59144,
  Mantle = 5000,
  Optimism = 10,
  Scroll = 534352,
  ZkSync = 324,
  Berachain = 80094,
  Sonic = 146,
  Monad = 143,
}

export const NATIVE_TOKEN_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

export enum TxStatus {
  INIT = 'init',
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export interface Token {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
}

export interface NetworkInfo {
  name: string;
  logo: string;
  scanLink: string;
  multiCall: string;
  defaultRpc: string;
  wrappedToken: Token;
  nativeLogo: string;
  coingeckoNetworkId: string | null;
  coingeckoNativeTokenId: string | null;
}

const wrap = (chainId: number, address: string, symbol: string): Token => ({
  address,
  symbol,
  name: 'Wrapped ' + symbol.slice(1),
  decimals: 18,
});

const stub = (name: string, defaultRpc: string, wrapped: Token, scanLink: string, multicall: string): NetworkInfo => ({
  name,
  logo: '',
  scanLink,
  multiCall: multicall,
  defaultRpc,
  wrappedToken: wrapped,
  nativeLogo: '',
  coingeckoNetworkId: null,
  coingeckoNativeTokenId: null,
});

export const NETWORKS_INFO: Record<ChainId, NetworkInfo> = {
  [ChainId.Ethereum]: stub('Ethereum', 'https://ethereum.kyberengineering.io', wrap(1, '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 'WETH'), 'https://etherscan.io', '0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696'),
  [ChainId.Bsc]: stub('BSC', 'https://bsc.kyberengineering.io', wrap(56, '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', 'WBNB'), 'https://bscscan.com', '0xed386Fe855C1EFf2f843B910923Dd8846E45C5A4'),
  [ChainId.PolygonPos]: stub('Polygon', 'https://polygon.kyberengineering.io', wrap(137, '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', 'WMATIC'), 'https://polygonscan.com', '0xed386Fe855C1EFf2f843B910923Dd8846E45C5A4'),
  [ChainId.Arbitrum]: stub('Arbitrum', 'https://arbitrum.kyberengineering.io', wrap(42161, '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', 'WETH'), 'https://arbiscan.io', '0x80C7DD17B01855a6D2347444a0FCC36136a314de'),
  [ChainId.Avalanche]: stub('Avalanche', 'https://avalanche.kyberengineering.io', wrap(43114, '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', 'WAVAX'), 'https://snowtrace.io', '0xF2FD8219609E28C61A998cc534681f95D2740f61'),
  [ChainId.Base]: stub('Base', 'https://mainnet.base.org', wrap(8453, '0x4200000000000000000000000000000000000006', 'WETH'), 'https://basescan.org', '0xcA11bde05977b3631167028862bE2a173976CA11'),
  [ChainId.Blast]: stub('Blast', 'https://rpc.blast.io', wrap(81457, '0x4300000000000000000000000000000000000004', 'WETH'), 'https://blastscan.io', '0xcA11bde05977b3631167028862bE2a173976CA11'),
  [ChainId.Fantom]: stub('Fantom', 'https://rpc.fantom.network', wrap(250, '0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83', 'WFTM'), 'https://ftmscan.com', '0x878dFE971d44e9122048308301F540910Bbd934c'),
  [ChainId.Linea]: stub('Linea', 'https://rpc.linea.build', wrap(59144, '0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f', 'WETH'), 'https://lineascan.build', '0xcA11bde05977b3631167028862bE2a173976CA11'),
  [ChainId.Mantle]: stub('Mantle', 'https://rpc.mantle.xyz', wrap(5000, '0x78c1b0C915c4FAA5FffA6CAbf0219DA63d7f4cb8', 'WMNT'), 'https://explorer.mantle.xyz', '0xcA11bde05977b3631167028862bE2a173976CA11'),
  [ChainId.Optimism]: stub('Optimism', 'https://optimism.kyberengineering.io', wrap(10, '0x4200000000000000000000000000000000000006', 'WETH'), 'https://optimistic.etherscan.io', '0xD9bfE9979e9CA4b2fe84bA5d4Cf963bBcB376974'),
  [ChainId.Scroll]: stub('Scroll', 'https://rpc.scroll.io', wrap(534352, '0x5300000000000000000000000000000000000004', 'WETH'), 'https://scrollscan.com', '0xcA11bde05977b3631167028862bE2a173976CA11'),
  [ChainId.ZkSync]: stub('zkSync', 'https://mainnet.era.zksync.io', wrap(324, '0x5AEa5775959fBC2557Cc8789bC1bf90A239D9a91', 'WETH'), 'https://explorer.zksync.io', '0xF9cda624FBC7e059355ce98a31693d299FACd963'),
  [ChainId.Berachain]: stub('Berachain', 'https://rpc.berachain.com', wrap(80094, '0x6969696969696969696969696969696969696969', 'WBERA'), 'https://berascan.com', '0xcA11bde05977b3631167028862bE2a173976CA11'),
  [ChainId.Sonic]: stub('Sonic', 'https://rpc.soniclabs.com', wrap(146, '0x039e2fb66102314ce7b64ce5ce3e5183bc94ad38', 'WS'), 'https://sonicscan.org', '0xcA11bde05977b3631167028862bE2a173976CA11'),
  [ChainId.Monad]: stub('Monad', 'https://testnet-rpc.monad.xyz', wrap(143, '0x0000000000000000000000000000000000000000', 'WMON'), 'https://testnet.monadexplorer.com', '0xcA11bde05977b3631167028862bE2a173976CA11'),
};
