"use client"

import { AppLayout } from "@/components/app-layout"
import { SwapInterface } from "@/components/swap-interface"
import { ScrollRevealTransactions } from "@/components/scroll-reveal-transactions"

export default function Page() {
  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="flex flex-1 justify-center pt-16">
          <div className="w-full max-w-md px-4">
            <SwapInterface />
          </div>
        </div>
      </div>
    </AppLayout>
  )
} 