// Shared cache version management for global invalidation
let globalCacheVersion = Date.now();

export function getGlobalCacheVersion(): number {
  return globalCacheVersion;
}

export function bumpGlobalCacheVersion(): number {
  globalCacheVersion = Date.now();
  return globalCacheVersion;
}

export function getCacheKeyWithVersion(baseKey: string): string[] {
  return [`${baseKey}-v${globalCacheVersion}`];
}
