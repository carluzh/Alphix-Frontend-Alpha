'use client'

import { AnimatedEmblems } from './AnimatedEmblems'

const CONNECT_WALLET_BANNER_HEIGHT = 216

export function AnimatedStyledBanner({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative overflow-hidden bg-muted/30 border border-sidebar-border/60 rounded-lg"
      style={{ height: CONNECT_WALLET_BANNER_HEIGHT }}
    >
      {/* Grid pattern overlay - using Alphix pattern.svg */}
      <div
        className="absolute inset-0 bg-center bg-repeat opacity-60"
        style={{
          backgroundImage: 'url(/pattern.svg)',
          backgroundSize: 'auto',
        }}
      />
      <AnimatedEmblems />
      <div className="relative w-full h-full z-10 flex flex-col items-center justify-center gap-4">
        {children}
      </div>
    </div>
  )
}
