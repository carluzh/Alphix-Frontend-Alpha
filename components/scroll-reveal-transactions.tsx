"use client"

import type React from "react"
import { CheckCircleIcon, ClockIcon, RefreshCwIcon } from "lucide-react"
import Image from "next/image"
import { motion, AnimatePresence } from "framer-motion"

const transactions = [
  {
    id: "tx1",
    type: "swap",
    status: "completed",
    timestamp: "2 minutes ago",
    from: { symbol: "ETH", amount: "0.5", icon: "/placeholder.svg?height=24&width=24" },
    to: { symbol: "USDC", amount: "1,112.50", icon: "/placeholder.svg?height=24&width=24" },
    hash: "0x1234...5678",
  },
  {
    id: "tx2",
    type: "swap",
    status: "pending",
    timestamp: "5 minutes ago",
    from: { symbol: "USDC", amount: "500", icon: "/placeholder.svg?height=24&width=24" },
    to: { symbol: "DAI", amount: "499.50", icon: "/placeholder.svg?height=24&width=24" },
    hash: "0xabcd...efgh",
  },
  {
    id: "tx3",
    type: "swap",
    status: "completed",
    timestamp: "10 minutes ago",
    from: { symbol: "WBTC", amount: "0.02", icon: "/placeholder.svg?height=24&width=24" },
    to: { symbol: "ETH", amount: "0.32", icon: "/placeholder.svg?height=24&width=24" },
    hash: "0x9876...5432",
  },
  {
    id: "tx4",
    type: "swap",
    status: "completed",
    timestamp: "1 hour ago",
    from: { symbol: "ETH", amount: "1.2", icon: "/placeholder.svg?height=24&width=24" },
    to: { symbol: "USDC", amount: "2,670.36", icon: "/placeholder.svg?height=24&width=24" },
    hash: "0xijkl...mnop",
  },
]

export function ScrollRevealTransactions({
  progress,
  visible,
}: {
  progress: number
  visible: boolean
}) {
  // Calculate rotation based on progress
  const rotation = progress * 360

  return (
    <div className="sticky bottom-6 px-4 lg:px-6">
      <div className="mx-auto max-w-md">
        <div className="relative">
          {/* Progress Circle */}
          <AnimatePresence>
            {!visible && (
              <motion.div
                className="absolute left-1/2 top-0 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: progress > 0 ? 1 : 0 }}
                exit={{ opacity: 0 }}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <RefreshCwIcon className="h-5 w-5" style={{ transform: `rotate(${rotation}deg)` }} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Transactions List */}
          <AnimatePresence>
            {visible && (
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                className="rounded-lg border bg-card shadow-sm"
              >
                <div className="space-y-2 p-4">
                  {transactions.map((tx) => (
                    <div key={tx.id} className="flex items-center justify-between rounded-lg border p-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                          {tx.status === "completed" ? (
                            <CheckCircleIcon className="h-5 w-5 text-green-500" />
                          ) : (
                            <ClockIcon className="h-5 w-5 text-amber-500" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-1 font-medium">
                            <span>Swap</span>
                          </div>
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <span>{tx.timestamp}</span>
                            <span>•</span>
                            <span className="text-xs">{tx.hash}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                          <Image
                            src={tx.from.icon || "/placeholder.svg"}
                            alt={tx.from.symbol}
                            width={16}
                            height={16}
                            className="rounded-full"
                          />
                          <span>{tx.from.amount}</span>
                          <span className="text-xs text-muted-foreground">{tx.from.symbol}</span>
                        </div>
                        <ArrowRightIcon className="h-4 w-4 text-muted-foreground" />
                        <div className="flex items-center gap-1">
                          <Image
                            src={tx.to.icon || "/placeholder.svg"}
                            alt={tx.to.symbol}
                            width={16}
                            height={16}
                            className="rounded-full"
                          />
                          <span>{tx.to.amount}</span>
                          <span className="text-xs text-muted-foreground">{tx.to.symbol}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
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

