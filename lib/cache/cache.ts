// Identical pattern to Uniswap functions/utils/cache.ts (adapted for Redis)
import { redis } from '@/lib/redis'

export interface Data {
  title: string
  image: string
  url: string
  name?: string
  ogImage?: string
}

const CACHE_NAME = 'functions-cache' as const
const MAX_AGE = 604800 // 1 week in seconds

class Cache {
  async match(request: string): Promise<Data | undefined> {
    if (!redis) return undefined
    try {
      const data = await redis.get<Data>(`${CACHE_NAME}:${request}`)
      if (!data) return undefined
      if (!data.title || !data.image || !data.url) return undefined
      return data
    } catch { return undefined }
  }

  async put(data: Data, request: string) {
    if (!redis) return
    try { await redis.set(`${CACHE_NAME}:${request}`, data, { ex: MAX_AGE }) } catch {}
  }
}

export default new Cache()
