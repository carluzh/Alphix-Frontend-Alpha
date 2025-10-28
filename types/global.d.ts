// Global type definitions for the liquidity system

declare global {
  type Maybe<T> = T | undefined | null

  // Window debugging flag
  interface Window {
    DEBUG?: boolean
  }
}

export {}