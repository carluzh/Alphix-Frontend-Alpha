export interface VersionEntry {
  version: string;
  title: string;
  bulletPoints: string[];
  releaseDate: string;
}

export const VERSION_LOG: VersionEntry[] = [
  {
    version: "1.1",
    title: "New Update - 1.1",
    bulletPoints: [
      "Improved Portfolio Page UX",
      "Mobile Support", 
      "Versioned Caching",
      "Liquidity Depth Performance Improvements"
    ],
    releaseDate: "2025-09-09"
  },
  {
    version: "1.0",
    title: "New Update - 1.0 ", 
    bulletPoints: [
      "Initial beta release",
      "Core swap functionality",
      "Liquidity provision features",
      "Portfolio tracking"
    ],
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
