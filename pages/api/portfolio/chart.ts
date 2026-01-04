import type { NextApiRequest, NextApiResponse } from 'next'

/**
 * Portfolio Chart API - Proxy to Uniswap's GetPortfolioChart
 *
 * Server-side proxy to bypass CSP restrictions when calling Uniswap's API.
 * Returns historical portfolio value data for charting.
 */

const UNISWAP_API_URL = 'https://interface.gateway.uniswap.org/v2/data.v1.DataApiService/GetPortfolioChart'

// ChartPeriod enum values (matches Uniswap's protobuf)
const CHART_PERIOD_MAP: Record<string, number> = {
  'HOUR': 1,
  'DAY': 2,
  'WEEK': 3,
  'MONTH': 4,
  'YEAR': 5,
}

// Base chain ID
const BASE_CHAIN_ID = '8453'

interface PortfolioChartPoint {
  timestamp: number
  value: number
}

interface PortfolioChartResponse {
  points: PortfolioChartPoint[]
  beginAt: number
  endAt: number
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PortfolioChartResponse | { message: string }>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` })
  }

  const { address, period = 'MONTH' } = req.query

  if (!address || typeof address !== 'string') {
    return res.status(400).json({ message: 'address is required' })
  }

  // Validate and map period
  const periodUpper = String(period).toUpperCase()
  const chartPeriod = CHART_PERIOD_MAP[periodUpper]
  if (!chartPeriod) {
    return res.status(400).json({ message: 'Invalid period. Use HOUR, DAY, WEEK, MONTH, or YEAR' })
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000) // 30s timeout

    const response = await fetch(UNISWAP_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-request-source': 'uniswap-web',
        'Origin': 'https://app.uniswap.org',
      },
      body: JSON.stringify({
        walletAccount: {
          platformAddresses: [
            { platform: 0, address: address } // 0 = EVM platform
          ]
        },
        chainIds: [BASE_CHAIN_ID],
        chartPeriod: chartPeriod,
      }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[portfolio/chart] Uniswap API error:', response.status, errorText)
      return res.status(response.status).json({ message: `Uniswap API error: ${response.status}` })
    }

    const data = await response.json()

    // Transform the response
    const points: PortfolioChartPoint[] = (data.points || []).map((p: any) => ({
      timestamp: parseInt(p.timestamp, 10),
      value: typeof p.value === 'number' ? p.value : parseFloat(p.value),
    }))

    const result: PortfolioChartResponse = {
      points,
      beginAt: parseInt(data.beginAt || '0', 10),
      endAt: parseInt(data.endAt || '0', 10),
    }

    // Cache for 5 minutes
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600')

    return res.status(200).json(result)
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.error('[portfolio/chart] Request timeout')
      return res.status(504).json({ message: 'Request timeout' })
    }

    console.error('[portfolio/chart] Error:', error)
    return res.status(500).json({ message: 'Failed to fetch portfolio chart data' })
  }
}
