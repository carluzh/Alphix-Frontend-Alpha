/**
 * Safe localStorage wrapper for financial infrastructure
 * Handles private browsing, quota limits, and storage failures gracefully
 */
class SafeStorage {
  /**
   * Safely get an item from localStorage
   * @param key - Storage key
   * @returns Value or null if unavailable/failed
   */
  static get(key: string): string | null {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return null;
      }
      return window.localStorage.getItem(key);
    } catch (error) {
      // Silently handle private browsing, quota exceeded, etc.
      console.warn(`[SafeStorage] Failed to get ${key}:`, error);
      return null;
    }
  }

  /**
   * Safely set an item in localStorage
   * @param key - Storage key
   * @param value - Value to store
   * @returns Success boolean
   */
  static set(key: string, value: string): boolean {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return false;
      }
      window.localStorage.setItem(key, value);
      return true;
    } catch (error) {
      // Silently handle private browsing, quota exceeded, etc.
      console.warn(`[SafeStorage] Failed to set ${key}:`, error);
      return false;
    }
  }

  /**
   * Safely remove an item from localStorage
   * @param key - Storage key
   */
  static remove(key: string): void {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return;
      }
      window.localStorage.removeItem(key);
    } catch (error) {
      // Silently handle errors
      console.warn(`[SafeStorage] Failed to remove ${key}:`, error);
    }
  }

  /**
   * Check if localStorage is available
   * @returns Availability boolean
   */
  static isAvailable(): boolean {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return false;
      }
      const testKey = '__storage_test__';
      window.localStorage.setItem(testKey, 'test');
      window.localStorage.removeItem(testKey);
      return true;
    } catch {
      return false;
    }
  }
}

export { SafeStorage };

// Make globally available for debugging/console access
if (typeof window !== 'undefined' && window) {
  try {
    Object.defineProperty(window, 'SafeStorage', {
      value: SafeStorage,
      writable: false,
      enumerable: true,
      configurable: true
    });
  } catch (e) {
    console.warn('Failed to set global SafeStorage:', e);
  }
}
