import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dark bg-background text-foreground">
      {children}
      <Analytics />
      <SpeedInsights />
    </div>
  )
}
