export type Pool = {
  id: string;
  tokens: {
    symbol: string;
    icon: string;
  }[];
  pair: string;
  volume24h: string;
  volume7d: string;
  fees24h: string;
  fees7d: string;
  liquidity: string;
  apr: string;
  highlighted: boolean; // Keep highlighted as boolean, page.tsx uses it.
}; 