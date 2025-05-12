"use client"

import type React from "react"

import { CheckCircleIcon, ChevronDownIcon, ClockIcon } from "lucide-react"
import { useState } from "react"
import Image from "next/image"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

const transactions = [
  {
    id: "tx1",
    type: "swap",
    status: "completed",
    timestamp: "2m ago",
    from: { symbol: "ETH", amount: "0.5", icon: "/placeholder.svg?height=24&width=24" },
    to: { symbol: "USDC", amount: "1,112.50", icon: "/placeholder.svg?height=24&width=24" },
    hash: "0x1234...5678",
  },
  {
    id: "tx2",
    type: "swap",
    status: "pending",
    timestamp: "5m ago",
    from: { symbol: "USDC", amount: "500", icon: "/placeholder.svg?height=24&width=24" },
    to: { symbol: "DAI", amount: "499.50", icon: "/placeholder.svg?height=24&width=24" },
    hash: "0xabcd...efgh",
  },
  {
    id: "tx3",
    type: "swap",
    status: "completed",
    timestamp: "10m ago",
    from: { symbol: "WBTC", amount: "0.02", icon: "/placeholder.svg?height=24&width=24" },
    to: { symbol: "ETH", amount: "0.32", icon: "/placeholder.svg?height=24&width=24" },
    hash: "0x9876...5432",
  },
]

export function RecentTransactions() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <Card className="border-muted/50 bg-transparent shadow-none">
      <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="w-full justify-between px-2 py-1 text-xs text-muted-foreground hover:bg-transparent"
          >
            Recent Transactions
            <ChevronDownIcon className={`h-3 w-3 transition-transform ${isOpen ? "rotate-180" : ""}`} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden">
          <CardContent className="grid gap-2 p-2 pt-2">
            {transactions.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between rounded-md border-muted/30 bg-muted/10 p-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  {tx.status === "completed" ? (
                    <CheckCircleIcon className="h-3 w-3 text-green-500" />
                  ) : (
                    <ClockIcon className="h-3 w-3 text-amber-500" />
                  )}
                  <span className="text-muted-foreground">{tx.timestamp}</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="flex items-center">
                    <Image
                      src={tx.from.icon || "/placeholder.svg"}
                      alt={tx.from.symbol}
                      width={12}
                      height={12}
                      className="rounded-full"
                    />
                    <span className="ml-1">{tx.from.amount}</span>
                    <span className="text-muted-foreground">{tx.from.symbol}</span>
                  </div>
                  <ArrowRightIcon className="h-3 w-3 text-muted-foreground" />
                  <div className="flex items-center">
                    <Image
                      src={tx.to.icon || "/placeholder.svg"}
                      alt={tx.to.symbol}
                      width={12}
                      height={12}
                      className="rounded-full"
                    />
                    <span className="ml-1">{tx.to.amount}</span>
                    <span className="text-muted-foreground">{tx.to.symbol}</span>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

function ArrowRightIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  )
}

