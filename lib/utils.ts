import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { getAddress } from "viem";
import { getToken, resolveTokenIcon, getTokenDefinitions, type TokenSymbol, type NetworkMode } from "./pools-config";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function shortenAddress(address: string, chars = 4): string {
  if (!address) return "";
  const parsed = getAddress(address);
  return `${parsed.substring(0, chars + 2)}...${parsed.substring(42 - chars)}`;
}

// Token display utilities - Format to actual token decimals (up to 6 max)
export const formatTokenDisplayAmount = (amount: string, tokenSymbol?: TokenSymbol, networkMode: NetworkMode = 'base') => {
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

export const getTokenIcon = (symbol?: string, _networkMode?: NetworkMode) => {
  return resolveTokenIcon(symbol ?? '');
};

const DEFAULT_TOKEN_COLOR = "#6B7280";

export const getTokenColor = (symbol?: string, networkMode?: NetworkMode): string => {
  if (!symbol) return DEFAULT_TOKEN_COLOR;
  const config = getToken(symbol as TokenSymbol, networkMode);
  return config?.color || DEFAULT_TOKEN_COLOR;
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


