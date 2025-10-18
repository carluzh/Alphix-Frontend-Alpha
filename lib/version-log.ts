export interface VersionEntry {
  version: string;
  title: string;
  newFeatures: string[];
  improvements: string[];
  releaseDate: string;
}

export const VERSION_LOG: VersionEntry[] = [
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
