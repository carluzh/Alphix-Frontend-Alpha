import { AppLayout } from "@/components/app-layout"
import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRightLeftIcon, LayersIcon, ArrowRightIcon } from 'lucide-react'
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export const metadata: Metadata = {
  title: 'Alphix | Dashboard',
  description: "Your DeFi Dashboard",
  icons: {
    icon: '/Tab.png',
  },
}

export default function DashboardPage() {
  return (
    <AppLayout>
      <div className="flex flex-1 flex-col px-4 py-8 md:px-6 md:py-12">
        <header className="mx-auto w-full max-w-5xl">
          <h1 className="mb-2 text-3xl font-bold">Welcome to Alphix</h1>
          <p className="text-muted-foreground">Your gateway to Base Sepolia DeFi</p>
        </header>
        
        <div className="mx-auto w-full max-w-5xl mt-10 grid gap-6 md:grid-cols-2">
          <Card className="p-6 card-gradient">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Quick Swap</h2>
              <div className="p-2 rounded-full bg-accent/10">
                <ArrowRightLeftIcon className="h-5 w-5 text-accent" />
              </div>
            </div>
            <p className="text-muted-foreground mb-4">Instantly swap tokens with zero or minimal slippage</p>
            <Link href="/swap" className="block mt-2">
              <Button className="w-full btn-primary gap-2 group">
                Go to Swap
                <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </Link>
          </Card>
          
          <Card className="p-6 card-gradient">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Liquidity</h2>
              <div className="p-2 rounded-full bg-accent/10">
                <LayersIcon className="h-5 w-5 text-accent" />
              </div>
            </div>
            <p className="text-muted-foreground mb-4">Add liquidity to earn trading fees and rewards</p>
            <Link href="/liquidity" className="block mt-2">
              <Button className="w-full btn-primary gap-2 group">
                Manage Liquidity
                <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </Link>
          </Card>
        </div>
      </div>
    </AppLayout>
  )
} 