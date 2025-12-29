import { MutationKey, hashKey as originalHashKey, QueryKey } from '@tanstack/react-query'

export function hashKey(queryKey: QueryKey | MutationKey): string {
  return originalHashKey(normalizeArrays(queryKey))
}

export function normalizeArrays<T>(value: T): T {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) {
    const normalized = value.map((item: T) => normalizeArrays(item))
    return [...normalized].sort((a, b) => {
      const aHash = originalHashKey([a])
      const bHash = originalHashKey([b])
      return aHash < bHash ? -1 : aHash > bHash ? 1 : 0
    }) as T
  }
  if (typeof value === 'object' && value.constructor === Object) {
    const normalized: Record<string, unknown> = {}
    for (const key in value) {
      if (Object.hasOwn(value, key)) normalized[key] = normalizeArrays((value as Record<string, unknown>)[key])
    }
    return normalized as T
  }
  return value
}
