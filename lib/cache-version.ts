// Global cache version management - stable until mutations
let globalVersion = Date.now();
const VERSION_TTL = 60 * 60 * 1000; // 1 hour TTL
let lastVersionUpdate = Date.now();

const GLOBAL_VERSION_KEY = 'alphix:global-version';
const VERSION_UPDATE_KEY = 'alphix:version-update-time';

// Restore global version from localStorage on module load (cross-session persistence)
if (typeof window !== 'undefined') {
  try {
    const storedVersion = localStorage.getItem(GLOBAL_VERSION_KEY);
    const storedUpdateTime = localStorage.getItem(VERSION_UPDATE_KEY);
    if (storedVersion && storedUpdateTime) {
      const versionNum = parseInt(storedVersion, 10);
      const updateTime = parseInt(storedUpdateTime, 10);
      const age = Date.now() - updateTime;
      // Only restore if less than VERSION_TTL old
      if (!isNaN(versionNum) && !isNaN(updateTime) && age < VERSION_TTL) {
        globalVersion = versionNum;
        lastVersionUpdate = updateTime;
      }
    }
  } catch (e) {
    console.warn('[cache-version] Failed to restore global version from localStorage:', e);
  }
}

export function getGlobalVersion(): number {
  // No automatic bump here; version changes on explicit bump or via cache-version route TTL check
  return globalVersion;
}

export function bumpGlobalVersion(): number {
  globalVersion = Date.now();
  lastVersionUpdate = Date.now();

  // Persist to localStorage for cross-session
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(GLOBAL_VERSION_KEY, globalVersion.toString());
      localStorage.setItem(VERSION_UPDATE_KEY, lastVersionUpdate.toString());
    } catch (e) {
      console.warn('[cache-version] Failed to persist global version:', e);
    }
  }

  return globalVersion;
}

export function getCacheKeyWithVersion(baseKey: string): string[] {
  const version = getGlobalVersion();
  return [`${baseKey}-v${version}`];
}

// Cleanup old cache entries from localStorage to prevent quota issues
export function cleanupExpiredCaches(): void {
  if (typeof window === 'undefined') return;

  try {
    const now = Date.now();
    const keysToRemove: string[] = [];

    // Find all alphix cache keys
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('alphix:cache:')) {
        try {
          const value = localStorage.getItem(key);
          if (value) {
            const parsed = JSON.parse(value);
            // Remove if older than 1 hour (conservative cleanup)
            if (parsed.timestamp && (now - parsed.timestamp > 60 * 60 * 1000)) {
              keysToRemove.push(key);
            }
          }
        } catch {
          // Corrupted entry - mark for removal
          keysToRemove.push(key);
        }
      }
    }

    // Remove expired entries
    keysToRemove.forEach(key => {
      try {
        localStorage.removeItem(key);
      } catch {}
    });

    if (keysToRemove.length > 0) {
      console.log(`[cache-version] Cleaned up ${keysToRemove.length} expired cache entries`);
    }
  } catch (e) {
    console.warn('[cache-version] Failed to cleanup expired caches:', e);
  }
}

// Run cleanup on module load (only once per session)
if (typeof window !== 'undefined') {
  // Delay cleanup to not block initial load
  setTimeout(() => {
    cleanupExpiredCaches();
  }, 5000);
}

// For debugging
export function debugVersion(): { version: number, ttl: number, expiresAt: number, age: number } {
  const now = Date.now();
  const result = {
    version: globalVersion,
    ttl: VERSION_TTL,
    expiresAt: lastVersionUpdate + VERSION_TTL,
    age: now - lastVersionUpdate
  };

  return result;
}
