// Identical to Uniswap functions/utils/getRequest.ts
import Cache, { Data } from '@/lib/cache/cache'

export async function getRequest<T extends Data>({ url, getData, validateData }: {
  url: string
  getData: () => Promise<T | undefined>
  validateData: (data: Data) => data is T
}): Promise<T | undefined> {
  try {
    const cachedData = await Cache.match(url)
    if (cachedData && validateData(cachedData)) return cachedData
    const data = await getData()
    if (!data) return undefined
    await Cache.put(data, url)
    return data
  } catch { return undefined }
}
