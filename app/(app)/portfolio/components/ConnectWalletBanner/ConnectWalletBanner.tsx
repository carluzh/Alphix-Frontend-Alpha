'use client'

import { AnimatedStyledBanner } from './AnimatedStyledBanner/AnimatedStyledBanner'

export function PortfolioConnectWalletBanner() {
  return (
    <AnimatedStyledBanner>
      <span className="text-sm font-medium text-foreground">
        Connect a wallet <span className="text-muted-foreground">to view your portfolio</span>
      </span>
      <div className="relative flex h-10 cursor-pointer items-center justify-center rounded-md bg-button-primary text-sidebar-primary border border-sidebar-primary px-8 font-semibold transition-all hover-button-primary overflow-hidden">
        {/* @ts-expect-error custom element provided by wallet kit */}
        <appkit-button className="absolute inset-0 z-10 block h-full w-full cursor-pointer p-0 opacity-0" />
        <span className="relative z-0 pointer-events-none">Connect</span>
      </div>
    </AnimatedStyledBanner>
  )
}
