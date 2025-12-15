export interface VersionEntry {
  version: string;
  title: string;
  tldr: string[];
  newFeatures?: string[];
  improvements?: string[];
  bugFixes?: string[];
  breaking?: string[];
  releaseDate: string;
}

export const VERSION_LOG: VersionEntry[] = [
  {
    version: "1.5.1",
    title: "Patch - v1.5.1",
    tldr: [
      "Swap quoting without wallet connection",
      "Liquidity: guard against intermittent all-zero cached pool stats",
      "Wide Connect Wallet button background uses pattern_wide.svg"
    ],
    releaseDate: "2025-12-15"
  },
  {
    version: "1.5.0",
    title: "Beta Update - v1.5.0",
    tldr: [
      "Mainnet Launch - Alphix is now live on Base mainnet with seamless testnet switching",
      "User Settings - Customize slippage tolerance and network preferences",
      "Caching Overhaul - Server-side caching for faster pool and price data loading"
    ],
    newFeatures: [
      "Network Mode Support - Switch between mainnet and testnet environments with automatic wallet chain detection and dedicated pool configurations for each network",
      "Redis Caching Layer - Server-side caching powered by Upstash Redis with intelligent cache invalidation, reducing load times for pool data, prices, and charts",
      "Sentry Integration - Production error monitoring and performance tracking to catch issues before they impact users",
      "User Settings - Persistent settings for slippage tolerance, network preferences, and transaction defaults that sync across sessions"
    ],
    improvements: [
      "App Performance - Portfolio, liquidity, and pool pages rebuilt with optimistic navigation and data prefetching for near-instant page transitions",
      "Price Service Overhaul - Redesigned price fetching architecture with batch APIs and more reliable USD quotes across all tokens",
      "Swap Interface Polish - Refined slippage controls with better visual feedback, clearer quote breakdowns, and smoother transaction flow",
      "APY Calculations - Simplified fee and APY logic for more accurate and consistent yield estimates across positions"
    ],
    releaseDate: "2025-12-05"
  },
  {
    version: "1.4",
    title: "Beta Update - v1.4.0",
    tldr: [
      "Zap Liquidity - Add liquidity with a single token, automatically swapping to optimal ratio",
      "Advanced Slippage Controls - Auto and custom slippage protection with price impact warnings"
    ],
    newFeatures: [
      "Zap Liquidity System - Single-token liquidity addition with automatic swap optimization using multiple algorithms, including fast iterative optimizer and tick simulator",
      "Preview Position Modal - Review position details, fees, and impact before confirming transactions",
      "Real-time Price Service - USD price tracking using pool internal prices via aUSDC quotes"
    ],
    improvements: [
      "Cache Invalidation System - Added optimistic updates for instant UI feedback on position changes and pool stats",
      "Zap Transaction Flow - Streamlined approval and execution flow with better error handling for zap transactions",
      "Position Calculations - Improved APY calculations and price impact estimates in preview modal"
    ],
    releaseDate: "2025-11-09"
  },
  {
    version: "1.3",
    title: "Beta Update - v1.3.0",
    tldr: [
      "All-in-one position management modal",
      "Live APY/APR calculator and improved analytics",
      "Mobile responsiveness improvements across the app"
    ],
    newFeatures: [
      "Complete Position Management System - All-in-one modal for add/remove liquidity and fee collection",
      "Real-time APY/APR Calculator - Live calculations based on pool volume and fees",
      "Interactive Position Charts - Visual range and liquidity depth displays",
      "Comprehensive Testing Suite - Full E2E tests for swap and liquidity flows",
      "Enhanced Pool Analytics - Lifetime fees tracking and detailed metrics"
    ],
    improvements: [
      "Swap Interface Redesign - Better input handling and token selection",
      "Liquidity Math Engine - Accurate tick-to-price conversions and depth calculations",
      "Mobile Responsiveness - Enhanced layouts across all pages",
      "Portfolio Page Overhaul - Cleaner layout with better position cards",
      "Toast Notifications - Improved feedback system with Sonner integration"
    ],
    bugFixes: [
      "Position information display fixes",
      "Liquidity addition transaction flow corrections",
      "Pool loading performance improvements",
      "Range selection calculations"
    ],
    breaking: [
      "Authentication System Removed - Beta login requirement removed, app is now publicly accessible",
      "Legacy APIs Deprecated - Old batch transaction and permit utilities removed"
    ],
    releaseDate: "2025-10-27"
  },
  {
    version: "1.1",
    title: "Beta Update - v1.1.0",
    tldr: [
      "Mobile support",
      "Portfolio layout improvements",
      "Faster data fetching and range selection"
    ],
    newFeatures: [
      "Mobile Support"
    ],
    improvements: [
      "Portfolio Page Layout",
      "Data Fetching",
      "Range Selection Performance"
    ],
    releaseDate: "2025-09-09"
  },
  {
    version: "1.0",
    title: "New Update - 1.0",
    tldr: [
      "Core swap",
      "Liquidity provision",
      "Portfolio tracking"
    ],
    newFeatures: [
      "Core Swap Functionality",
      "Liquidity Provision",
      "Portfolio Tracking"
    ],
    releaseDate: "2025-01-01"
  }
];

export const getLatestVersion = (): VersionEntry => VERSION_LOG[0];

export const getVersionByNumber = (versionNumber: string): VersionEntry | undefined => {
  return VERSION_LOG.find(entry => entry.version === versionNumber);
};

export const getLatestVersionSummary = (): string => {
  const latest = getLatestVersion();
  const features = latest.newFeatures?.join(', ') || '';
  const improvements = latest.improvements?.slice(0, 2).join(' & ') || '';

  if (features && improvements) {
    return `${features} with improved ${improvements}`;
  } else if (features) {
    return features;
  } else if (improvements) {
    return `Improved ${improvements}`;
  }
  return latest.tldr?.[0] || 'Latest updates and improvements';
};

export const getTimeAgo = (releaseDate: string): string => {
  const release = new Date(releaseDate);
  const now = new Date();
  const diffMs = now.getTime() - release.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffWeeks = Math.floor(diffDays / 7);
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  if (diffDays < 1) {
    return `${diffHours}h ago`;
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    return `${diffWeeks}w ago`;
  }
};
