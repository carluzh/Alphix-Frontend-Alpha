import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { getAddress, formatUnits } from "viem";
import { getToken, type TokenSymbol, TOKEN_DEFINITIONS } from "./pools-config";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function shortenAddress(address: string, chars = 4): string {
  if (!address) return "";
  const parsed = getAddress(address);
  return `${parsed.substring(0, chars + 2)}...${parsed.substring(42 - chars)}`;
}

export function absoluteUrl(path: string) {
  return `${process.env.NEXT_PUBLIC_APP_URL}${path}`;
}

// Token display utilities
export const formatTokenDisplayAmount = (amount: string) => {
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  if (num === 0) return "0.00";
  if (num > 0 && num < 0.0001) return "< 0.0001";
  return num.toFixed(4);
};

export const getTokenIcon = (symbol?: string) => {
  if (!symbol) return "/placeholder-logo.svg";
  
  const tokenConfig = getToken(symbol as TokenSymbol);
  if (tokenConfig?.icon) {
    return tokenConfig.icon;
  }
  
  return "/placeholder-logo.svg";
};

export const sanitizeDecimalInput = (input: string) => {
  if (!input) return '';
  const cleaned = input.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot === -1) return cleaned;
  // keep first dot, remove subsequent dots
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
export const getTokenSymbolByAddress = (address: string): TokenSymbol | null => {
  const normalizedAddress = address.toLowerCase();
  for (const [symbol, tokenConfig] of Object.entries(TOKEN_DEFINITIONS)) {
    if (tokenConfig.address.toLowerCase() === normalizedAddress) {
      return symbol as TokenSymbol;
    }
  }
  return null;
};

// Fee display utility for uncollected fees
export const formatUncollectedFee = (feeAmount: string, tokenSymbol: TokenSymbol) => {
  try {
    const decimals = TOKEN_DEFINITIONS[tokenSymbol]?.decimals ?? 18;
    const displayDecimals = TOKEN_DEFINITIONS[tokenSymbol]?.displayDecimals ?? 4;
    const amount = parseFloat(formatUnits(BigInt(feeAmount), decimals));
    
    if (!Number.isFinite(amount) || amount <= 0) return null;
    
    return amount > 0 && amount < 0.001 ? '< 0.001' : amount.toFixed(displayDecimals);
  } catch {
    return null;
  }
};
