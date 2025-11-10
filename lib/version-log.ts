export interface VersionEntry {
  version: string;
  title: string;
  tldr?: string[];
  newFeatures: string[];
  improvements: string[];
  bugFixes?: string[];
  breaking?: string[];
  releaseDate: string;
}

export const VERSION_LOG: VersionEntry[] = [
  {
    version: "1.4",
    title: "Beta Update - v1.4 What's New",
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
    title: "Beta Update - v1.3 What's New",
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
    title: "Beta Update - v1.1 What's New",
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
    title: "New Update - 1.0 ",
    newFeatures: [
      "Core Swap Functionality",
      "Liquidity Provision",
      "Portfolio Tracking"
    ],
    improvements: [],
    releaseDate: "2025-01-01"
  }
];

// Get the latest version
export const getLatestVersion = (): VersionEntry => {
  return VERSION_LOG[0]; // First entry is always the latest
};

// Get version by number
export const getVersionByNumber = (versionNumber: string): VersionEntry | undefined => {
  return VERSION_LOG.find(entry => entry.version === versionNumber);
};

// Get a summary of the latest version changes
export const getLatestVersionSummary = (): string => {
  const latest = getLatestVersion();
  const features = latest.newFeatures.join(', ');
  const improvements = latest.improvements.slice(0, 2).join(' & '); // Take first 2 improvements

  if (features && improvements) {
    return `${features} with improved ${improvements}`;
  } else if (features) {
    return features;
  } else if (improvements) {
    return `Improved ${improvements}`;
  }
  return 'Latest updates and improvements';
};

// Get time ago from release date
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
