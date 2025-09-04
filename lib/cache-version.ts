// Global cache version using environment variable (persists across function invocations)
let globalCacheVersion = parseInt(process.env.CACHE_VERSION || '0', 10) || Date.now();

export function getGlobalCacheVersion(): number {
  return globalCacheVersion;
}

export function bumpGlobalCacheVersion(): number {
  globalCacheVersion = Date.now();
  // In serverless, we can't modify process.env, but we can return the new version
  // The version will be used immediately in the current request
  console.log(`[Cache] Version bumped to: ${globalCacheVersion}`);
  return globalCacheVersion;
}

export function getCacheKeyWithVersionSync(baseKey: string): string[] {
  const version = getGlobalCacheVersion();
  const key = [`${baseKey}-v${version}`];
  console.log(`[Cache] Generated key: ${key[0]}`);
  return key;
}

// For debugging - check if version is actually changing
export function debugCacheVersion(): { current: number, env: string } {
  return {
    current: globalCacheVersion,
    env: process.env.CACHE_VERSION || 'not set'
  };
}
