import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { getAddress, formatUnits } from "viem";
import { getToken, getTokenDefinitions, type TokenSymbol, type NetworkMode } from "./pools-config";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Format token amounts to max decimals (default 6) without abbreviation
export function formatTokenAmount(amount: string | number, maxDecimals: number = 6): string {
  if (!amount || amount === '0' || amount === 0) return '0';

  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (!Number.isFinite(numAmount)) return '0';

  // Use toFixed to limit decimals
  const formatted = numAmount.toFixed(maxDecimals);

  // Remove trailing zeros after decimal point
  return formatted.replace(/\.?0+$/, '') || "0";
}

export function shortenAddress(address: string, chars = 4): string {
  if (!address) return "";
  const parsed = getAddress(address);
  return `${parsed.substring(0, chars + 2)}...${parsed.substring(42 - chars)}`;
}

// Token display utilities - Format to actual token decimals (up to 6 max)
export const formatTokenDisplayAmount = (amount: string, tokenSymbol?: TokenSymbol, networkMode: NetworkMode = 'mainnet') => {
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  if (num === 0) return "0";
  if (num > 0 && num < 0.000001) return "< 0.000001";

  // Determine the number of decimals to use
  let decimalsToUse = 6; // default max
  if (tokenSymbol) {
    const tokenDefinitions = getTokenDefinitions(networkMode);
    const tokenConfig = tokenDefinitions[tokenSymbol];
    const tokenDecimals = tokenConfig?.decimals ?? 18;
    // Use the minimum of token's actual decimals and 6
    decimalsToUse = Math.min(tokenDecimals, 6);
  }

  const formatted = num.toFixed(decimalsToUse);

  // Remove trailing zeros after decimal point
  return formatted.replace(/\.?0+$/, '') || "0";
};

export const getTokenIcon = (symbol?: string, networkMode: NetworkMode = 'mainnet') => {
  if (!symbol) return "/placeholder-logo.svg";

  const tokenConfig = getToken(symbol as TokenSymbol, networkMode);
  if (tokenConfig?.icon) {
    return tokenConfig.icon;
  }

  return "/placeholder-logo.svg";
};

export const sanitizeDecimalInput = (input: string) => {
  if (!input) return '';
  // Treat commas as dots first
  const normalized = input.replace(/,/g, '.');
  // Allow only digits and dots
  const cleaned = normalized.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot === -1) return cleaned;
  // Keep first dot, remove subsequent dots
  const head = cleaned.slice(0, firstDot + 1);
  const tail = cleaned.slice(firstDot + 1).replace(/\./g, '');
  return head + tail;
};

export const debounce = <T extends (...args: any[]) => any>(func: T, waitFor: number) => {
  let timeout: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), waitFor);
  };
};

// Token symbol mapping utility
export const getTokenSymbolByAddress = (address: string, networkMode: NetworkMode = 'mainnet'): TokenSymbol | null => {
  const normalizedAddress = address.toLowerCase();
  const tokenDefinitions = getTokenDefinitions(networkMode);
  for (const [symbol, tokenConfig] of Object.entries(tokenDefinitions)) {
    if (tokenConfig.address.toLowerCase() === normalizedAddress) {
      return symbol as TokenSymbol;
    }
  }
  return null;
};

// Fee display utility for uncollected fees
export const formatUncollectedFee = (feeAmount: string, tokenSymbol: TokenSymbol, networkMode: NetworkMode = 'mainnet') => {
  try {
    const tokenDefinitions = getTokenDefinitions(networkMode);
    const decimals = tokenDefinitions[tokenSymbol]?.decimals ?? 18;
    const amount = parseFloat(formatUnits(BigInt(feeAmount), decimals));

    if (!Number.isFinite(amount) || amount <= 0) return null;

    return amount > 0 && amount < 0.001 ? '< 0.001' : amount.toFixed(6);
  } catch {
    return null;
  }
};
