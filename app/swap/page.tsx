import { AppLayout } from "@/components/app-layout"
import { SwapInterface } from "@/components/swap/swap-interface"
import { ScrollRevealTransactions } from "@/components/scroll-reveal-transactions"
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Swap',
}

export default function Page() {
  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="flex flex-1 justify-center py-10 md:py-16">
          <div className="w-full max-w-md px-4">
            <SwapInterface />
          </div>
        </div>
      </div>
    </AppLayout>
  )
} 