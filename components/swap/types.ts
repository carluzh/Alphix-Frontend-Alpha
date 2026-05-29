import type { NetworkMode } from "@/lib/network-mode";

// Enhanced Token interface — includes chain metadata for cross-chain token selector
export interface Token {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  balance: string;
  value: string;
  icon: string;
  usdPrice: number;
  networkMode?: NetworkMode;
  chainId?: number;
  chainIcon?: string;
  chainLabel?: string;
}
