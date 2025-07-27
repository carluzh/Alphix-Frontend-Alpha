import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { getAddress } from "viem";

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
