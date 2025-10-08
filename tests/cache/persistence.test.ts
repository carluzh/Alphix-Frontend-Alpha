/**
 * Tests for localStorage persistence
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  getFromLocalStorage,
  setToLocalStorage,
  removeFromLocalStorage,
  clearStorageVersion,
  getStorageInfo,
  storageKeys,
} from '@/lib/cache/client/persistence'

// Mock SafeStorage
vi.mock('@/lib/safe-storage', () => ({
  SafeStorage: {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
  },
}))

import { SafeStorage } from '@/lib/safe-storage'

describe('localStorage Persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('setToLocalStorage', () => {
    it('should store data with version and timestamp', () => {
      const key = 'test-key'
      const data = { foo: 'bar' }

      setToLocalStorage(key, data)

      expect(SafeStorage.set).toHaveBeenCalledWith(
        key,
        expect.stringContaining('"version":"v1"')
      )
      expect(SafeStorage.set).toHaveBeenCalledWith(
        key,
        expect.stringContaining('"data":{"foo":"bar"}')
      )
      expect(SafeStorage.set).toHaveBeenCalledWith(
        key,
        expect.stringContaining('"timestamp":')
      )
    })

    it('should handle errors gracefully', () => {
      vi.mocked(SafeStorage.set).mockImplementation(() => {
        throw new Error('Storage full')
      })

      // Should not throw
      expect(() => setToLocalStorage('key', 'data')).not.toThrow()
    })
  })

  describe('getFromLocalStorage', () => {
    it('should return data if fresh and valid version', () => {
      const data = { foo: 'bar' }
      const entry = {
        data,
        timestamp: Date.now(),
        version: 'v1',
      }

      vi.mocked(SafeStorage.get).mockReturnValue(JSON.stringify(entry))

      const result = getFromLocalStorage<typeof data>('test-key')

      expect(result).toEqual(data)
    })

    it('should return null if data is expired', () => {
      const entry = {
        data: { foo: 'bar' },
        timestamp: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
        version: 'v1',
      }

      vi.mocked(SafeStorage.get).mockReturnValue(JSON.stringify(entry))

      const result = getFromLocalStorage('test-key', 60 * 60 * 1000) // 1 hour TTL

      expect(result).toBeNull()
      expect(SafeStorage.remove).toHaveBeenCalledWith('test-key')
    })

    it('should return null if version mismatch', () => {
      const entry = {
        data: { foo: 'bar' },
        timestamp: Date.now(),
        version: 'v0', // Old version
      }

      vi.mocked(SafeStorage.get).mockReturnValue(JSON.stringify(entry))

      const result = getFromLocalStorage('test-key')

      expect(result).toBeNull()
      expect(SafeStorage.remove).toHaveBeenCalledWith('test-key')
    })

    it('should return null if key not found', () => {
      vi.mocked(SafeStorage.get).mockReturnValue(null)

      const result = getFromLocalStorage('test-key')

      expect(result).toBeNull()
    })

    it('should handle corrupted data gracefully', () => {
      vi.mocked(SafeStorage.get).mockReturnValue('invalid json')

      const result = getFromLocalStorage('test-key')

      expect(result).toBeNull()
    })
  })

  describe('removeFromLocalStorage', () => {
    it('should remove data', () => {
      removeFromLocalStorage('test-key')

      expect(SafeStorage.remove).toHaveBeenCalledWith('test-key')
    })

    it('should handle errors gracefully', () => {
      vi.mocked(SafeStorage.remove).mockImplementation(() => {
        throw new Error('Remove failed')
      })

      expect(() => removeFromLocalStorage('test-key')).not.toThrow()
    })
  })

  describe('storageKeys', () => {
    it('should generate versioned keys', () => {
      expect(storageKeys.userPositionIds('0xabc')).toBe('v1:user:0xabc:positionIds')
      expect(storageKeys.poolAddress('token0', 'token1', 3000, 1)).toBe(
        'v1:pool:1:token0:token1:3000'
      )
      expect(storageKeys.tokenMetadata('0xdef', 1)).toBe('v1:token:1:0xdef')
    })

    it('should lowercase addresses', () => {
      expect(storageKeys.userPositionIds('0xABC')).toBe('v1:user:0xabc:positionIds')
    })
  })

  describe('clearStorageVersion', () => {
    it('should clear all keys with matching version', () => {
      // Mock localStorage
      const mockLocalStorage = {
        length: 3,
        key: (i: number) => ['v1:key1', 'v1:key2', 'v0:key3'][i],
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      }

      Object.defineProperty(global, 'window', {
        value: { localStorage: mockLocalStorage },
        writable: true,
      })

      clearStorageVersion('v1')

      expect(SafeStorage.remove).toHaveBeenCalledWith('v1:key1')
      expect(SafeStorage.remove).toHaveBeenCalledWith('v1:key2')
      expect(SafeStorage.remove).not.toHaveBeenCalledWith('v0:key3')
    })
  })

  describe('getStorageInfo', () => {
    it('should return storage statistics', () => {
      const mockLocalStorage = {
        length: 3,
        key: (i: number) => ['v1:key1', 'v1:key2', 'other:key'][i],
        getItem: (key: string) => 'some value',
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      }

      Object.defineProperty(global, 'window', {
        value: { localStorage: mockLocalStorage },
        writable: true,
      })

      const info = getStorageInfo()

      expect(info.keys).toBe(3)
      expect(info.versionedKeys).toBe(2) // v1:key1 and v1:key2
      expect(info.estimatedSize).toBeGreaterThan(0)
    })
  })
})
