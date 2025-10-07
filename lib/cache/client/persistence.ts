/**
 * localStorage persistence helpers
 * Provides safe, versioned localStorage access with TTL support
 */

import { SafeStorage } from '@/lib/safe-storage'

const STORAGE_VERSION = 'v1'
const DEFAULT_TTL = 60 * 60 * 1000 // 1 hour

interface StorageEntry<T> {
  data: T
  timestamp: number
  version: string
}

/**
 * Storage key factory with versioning
 */
export const storageKeys = {
  userPositionIds: (address: string) =>
    `${STORAGE_VERSION}:user:${address.toLowerCase()}:positionIds`,
  poolAddress: (token0: string, token1: string, fee: number, chainId: number) =>
    `${STORAGE_VERSION}:pool:${chainId}:${token0}:${token1}:${fee}`,
  tokenMetadata: (address: string, chainId: number) =>
    `${STORAGE_VERSION}:token:${chainId}:${address}`,
}

/**
 * Get data from localStorage with TTL checking
 */
export function getFromLocalStorage<T>(key: string, ttl = DEFAULT_TTL): T | null {
  try {
    const raw = SafeStorage.get(key)
    if (!raw) return null

    const entry = JSON.parse(raw) as StorageEntry<T>

    // Check version
    if (entry.version !== STORAGE_VERSION) {
      SafeStorage.remove(key)
      return null
    }

    // Check TTL
    const age = Date.now() - entry.timestamp
    if (age > ttl) {
      SafeStorage.remove(key)
      return null
    }

    return entry.data
  } catch (error) {
    console.warn('[Storage] Failed to read from localStorage:', error)
    return null
  }
}

/**
 * Set data in localStorage with version and timestamp
 */
export function setToLocalStorage<T>(key: string, data: T): void {
  try {
    const entry: StorageEntry<T> = {
      data,
      timestamp: Date.now(),
      version: STORAGE_VERSION,
    }
    SafeStorage.set(key, JSON.stringify(entry))
  } catch (error) {
    console.warn('[Storage] Failed to write to localStorage:', error)
  }
}

/**
 * Remove data from localStorage
 */
export function removeFromLocalStorage(key: string): void {
  try {
    SafeStorage.remove(key)
  } catch (error) {
    console.warn('[Storage] Failed to remove from localStorage:', error)
  }
}

/**
 * Clear all data for a specific version
 */
export function clearStorageVersion(version = STORAGE_VERSION): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return

    const keysToRemove: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (key?.startsWith(`${version}:`)) {
        keysToRemove.push(key)
      }
    }

    keysToRemove.forEach((key) => SafeStorage.remove(key))
  } catch (error) {
    console.warn('[Storage] Failed to clear storage version:', error)
  }
}

/**
 * Get storage usage info (for debugging)
 */
export function getStorageInfo(): {
  keys: number
  versionedKeys: number
  estimatedSize: number
} {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { keys: 0, versionedKeys: 0, estimatedSize: 0 }
    }

    let versionedKeys = 0
    let estimatedSize = 0

    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (key) {
        if (key.startsWith(`${STORAGE_VERSION}:`)) {
          versionedKeys++
        }
        const value = window.localStorage.getItem(key)
        if (value) {
          estimatedSize += key.length + value.length
        }
      }
    }

    return {
      keys: window.localStorage.length,
      versionedKeys,
      estimatedSize,
    }
  } catch {
    return { keys: 0, versionedKeys: 0, estimatedSize: 0 }
  }
}
