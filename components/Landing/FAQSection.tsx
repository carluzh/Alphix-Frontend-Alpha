'use client'

import { useState } from 'react'
import { Plus, Minus } from 'lucide-react'

const FAQItem = ({
  question,
  answer,
  number,
  isOpen,
  onToggle,
}: {
  question: string
  answer: string
  number: string
  isOpen: boolean
  onToggle: () => void
}) => {
  return (
    <div className="transition-colors">
      <button
        onClick={onToggle}
        className="group flex w-full cursor-pointer items-center gap-3 md:gap-4 py-3 text-left"
      >
        {/* Number badge - rounded square with bg only */}
        <div className="hidden lg:flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent/50 font-mono text-xs text-muted-foreground">
          {number}
        </div>
        <div className="flex-1">
          <h3 className="text-sm md:text-base text-foreground">{question}</h3>
        </div>
        <div className="shrink-0">
          {isOpen ? (
            <Minus className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Plus className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>
      <div
        className="grid transition-all duration-300 ease-in-out"
        style={{
          gridTemplateRows: isOpen ? '1fr' : '0fr',
        }}
      >
        <div className="overflow-hidden">
          <div className="pb-4 lg:pl-12">
            <p className="text-muted-foreground leading-relaxed text-sm">
              {answer}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

const faqItems = [
  {
    number: '01',
    question: 'What is Alphix?',
    answer:
      'Alphix is a DeFi protocol built on Uniswap V4 that introduces Unified Pools. By stacking multiple features into a single pool, we eliminate liquidity fragmentation and create more efficient markets. Think dynamic fees, liquidity rehypothecation, and other innovations, all coexisting without splitting liquidity.',
  },
  {
    number: '02',
    question: 'What problem does Alphix solve?',
    answer:
      'The main barrier to hook adoption is fragmentation. Every new feature typically requires its own pool, splitting liquidity and volume. Alphix solves this with Unified Pools that combine multiple features into one, enabling us to compete with larger incumbents despite their liquidity depth advantages.',
  },
  {
    number: '03',
    question: 'How do dynamic fees work?',
    answer:
      "Unlike traditional AMMs locked to fixed fee tiers, our dynamic fee algorithm is fully unbounded. It adjusts fees in real-time based on each pool's Volume/TVL ratio, finding the market optimum automatically. Quiet markets see lower fees to attract volume, while busy periods increase fees to maximize LP returns.",
  },
  {
    number: '04',
    question: 'Is Alphix safe to use?',
    answer:
      'Security is non-negotiable for us. We work with leading security teams to audit every feature before it is added to Unified Pools. Alphix is fully non-custodial, meaning you retain complete control over your assets at all times. No protocol can be considered entirely risk-free, but we take extensive steps to minimize risks.',
  },
  {
    number: '05',
    question: 'Which chains is Alphix available on?',
    answer:
      'Alphix is live on Base. We chose Base for its strong growth potential and alignment with the Uniswap ecosystem.',
  },
  {
    number: '06',
    question: 'How can I provide liquidity or trade?',
    answer:
      'You can provide liquidity directly through our app by depositing tokens into Unified Pools. For trading, you can swap directly on Alphix or through aggregators like KyberSwap and 1inch once integrated.',
  },
]

export const FAQSection = () => {
  const [openIndex, setOpenIndex] = useState<string | null>(null)

  const handleToggle = (number: string) => {
    setOpenIndex(openIndex === number ? null : number)
  }

  return (
    <div
      className="animate-on-scroll w-full"
    >
      {/* Section Title */}
      <h2 className="text-lg md:text-xl font-medium text-foreground mb-6">
        FAQ
      </h2>

      <div className="flex flex-col">
        {faqItems.map((item) => (
          <FAQItem
            key={item.number}
            number={item.number}
            question={item.question}
            answer={item.answer}
            isOpen={openIndex === item.number}
            onToggle={() => handleToggle(item.number)}
          />
        ))}
      </div>
    </div>
  )
}
