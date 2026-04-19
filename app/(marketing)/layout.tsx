import { ConditionalAnalytics } from '@/components/ConditionalAnalytics'
import { Toaster } from '@/components/ui/sonner'

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dark bg-background text-foreground">
      {children}
      <Toaster position="top-right" />
      <ConditionalAnalytics />
    </div>
  )
}
