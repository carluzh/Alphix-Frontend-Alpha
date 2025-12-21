export interface Pool {
  id: string;
  tokens: {
    symbol: string;
    icon: string;
    address?: string;
  }[];
  pair: string;
  volume24h: string;
  fees24h: string;
  volume24hUSD?: number;
  fees24hUSD?: number;
  liquidity: string;
  tvlUSD?: number;
  apr: string;
  highlighted: boolean;
  positionsCount?: number;
  dynamicFeeBps?: number;
  type?: string;
}
