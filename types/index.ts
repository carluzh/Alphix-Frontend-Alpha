export interface Pool {
  id: string;
  tokens: {
    symbol: string;
    icon: string;
    address?: string; // Add optional address property
  }[];
  pair: string;
  volume24h: string;
  volume7d: string;
  fees24h: string;
  fees7d: string;
  volume24hUSD?: number;
  fees24hUSD?: number;
  volume7dUSD?: number;
  fees7dUSD?: number;
  liquidity: string;
  tvlUSD?: number;
  apr: string;
  highlighted: boolean;
  positionsCount?: number;
  dynamicFeeBps?: number;
  volume48hUSD?: number;
  volumeChangeDirection?: 'up' | 'down' | 'neutral' | 'loading';
  tvlYesterdayUSD?: number;
  tvlChangeDirection?: 'up' | 'down' | 'neutral' | 'loading';
  type?: string;
} 