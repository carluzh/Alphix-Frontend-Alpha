import { ConditionalAnalytics } from '@/components/ConditionalAnalytics'

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dark bg-background text-foreground">
      {children}
      <ConditionalAnalytics />
    </div>
  )
}
