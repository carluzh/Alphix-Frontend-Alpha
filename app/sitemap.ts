import type { MetadataRoute } from 'next'
import mainnetPools from '../config/pools.json'

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://alphix.fi'

  const staticRoutes = [
    { route: '', priority: 1.0 },
    { route: '/overview', priority: 0.9 },
    { route: '/liquidity', priority: 0.85 },
    { route: '/points', priority: 0.8 },
    { route: '/liquidity/add', priority: 0.75 },
    { route: '/swap', priority: 0.7 },
  ]

  const poolRoutes = mainnetPools.pools
    .filter(pool => pool.enabled)
    .map(pool => ({
      route: `/liquidity/${pool.id}`,
      priority: 0.8,
    }))

  const allRoutes = [...staticRoutes, ...poolRoutes]

  return allRoutes.map(({ route, priority }) => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: 'daily' as const,
    priority,
  }))
}
