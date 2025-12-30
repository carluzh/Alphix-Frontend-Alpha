/**
 * Vitest Setup File
 *
 * Setup for testing Alphix Apollo hooks and React components.
 * Mirrors Uniswap's test setup approach.
 *
 * @see interface/apps/web/src/test-utils/render.tsx
 */

import '@testing-library/jest-dom/vitest'

// Mock window.matchMedia for jsdom
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}))
