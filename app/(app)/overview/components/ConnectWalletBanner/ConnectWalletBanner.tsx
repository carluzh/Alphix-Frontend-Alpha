'use client'

import { AnimatedStyledBanner } from './AnimatedStyledBanner/AnimatedStyledBanner'
import { appKit } from '@/components/AppKitProvider'

export function OverviewConnectWalletBanner() {
  const handleConnect = () => {
    appKit?.open()
  }

  return (
    <AnimatedStyledBanner>
      <span className="text-sm font-medium text-foreground">
        Connect a wallet <span className="text-muted-foreground">to view your account</span>
      </span>
      <button
        type="button"
        onClick={handleConnect}
        className="flex h-10 cursor-pointer items-center justify-center rounded-md bg-button-primary text-sidebar-primary border border-sidebar-primary px-8 font-semibold transition-all hover-button-primary"
      >
        Connect
      </button>
    </AnimatedStyledBanner>
  )
}
