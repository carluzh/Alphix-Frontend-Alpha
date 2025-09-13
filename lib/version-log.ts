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
