'use client'

import { useState } from 'react'
import Link from 'next/link'
import { IconPlus, IconMinus } from 'nucleo-micro-bold-essential'

const FAQItem = ({
  question,
  answer,
  number,
  isOpen,
  onToggle,
}: {
  question: string
  answer: React.ReactNode
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
        <div className="hidden lg:flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent/50 font-mono text-xs text-muted-foreground">
          {number}
        </div>
        <div className="flex-1">
          <h3 className="text-sm md:text-base text-foreground">{question}</h3>
        </div>
        <div className="shrink-0">
          {isOpen ? (
            <IconMinus className="h-4 w-4 text-muted-foreground" />
          ) : (
            <IconPlus className="h-4 w-4 text-muted-foreground" />
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

const faqItems: { number: string; question: string; answer: React.ReactNode }[] = [
  {
    number: '01',
    question: 'What is Alphix?',
    answer:
      'Alphix is the non-custodial market maker for onchain protocols. We build a custom Uniswap v4 pool around a protocol\u2019s token and provide the infrastructure that manages its liquidity - leveraging AI agents and dedicated algorithms. Alphix is live on Base and Arbitrum.',
  },
  {
    number: '02',
    question: 'What problem does Alphix solve?',
    answer: (
      <>
        Every DeFi protocol needs deep, stable liquidity for its token. Today&rsquo;s options are a vanilla DEX pool and self-managed liquidity that bleeds value to MEV, a market maker retainer that takes custody and walks when the contract ends, or an ALM optimizing liquidity on top of a flawed, one-size-fits-all pool.
        <br /><br />
        Alphix is the permissionless alternative that handles liquidity infrastructure end-to-end - deep markets that earn more, so protocol teams can focus on building.
      </>
    ),
  },
  {
    number: '03',
    question: 'How is Alphix different from an ALM?',
    answer:
      'Automated Liquidity Managers rebalance positions on top of generic pools they cannot change. Alphix deploys the pool itself, which lets our agent handle not just the positions but also the underlying pool fees. Pricing is performance-only, and the agent operates within bounds the protocol sets - non-custodial throughout.',
  },
  {
    number: '04',
    question: 'How does liquidity delegation work?',
    answer:
      'The protocol deposits liquidity into an Alphix pool like any other LP, then delegates ongoing management to our agentic backend with a single signature. Custody of the underlying assets never leaves the protocol. The agent operates under a whitelisted set of on-chain actions - it can rebalance positions and adjust fees, but cannot move or withdraw funds.',
  },
  {
    number: '05',
    question: 'What makes an Alphix pool more efficient?',
    answer:
      'A vanilla pool applies one static fee tier and leaves idle capital idle. Alphix pools adjust fees to volatility in real time, apply asymmetric buy and sell fees to defend against one-sided pressure, and route idle treasury to lending markets for extra yield between swaps. MEV that would otherwise leak to external bots is rebated to the protocol.',
  },
  {
    number: '06',
    question: 'Is Alphix safe to use?',
    answer:
      'Security is non-negotiable for us. Our contracts have been audited by Sherlock with zero critical findings, and a $30k bug bounty is live on their platform. Alphix is fully non-custodial, meaning protocols retain control of their assets at all times. No protocol can be considered entirely risk-free, but we take extensive steps to minimize risks.',
  },
  {
    number: '07',
    question: 'How does a protocol get started with Alphix?',
    answer: (
      <>
        The process starts with a short scoping call to align on the token profile and the primitives that matter most - asymmetric fees, volatility response, rehypothecation. From there, pool deployment and delegation typically happen within days, not weeks.{' '}
        <a
          href="https://x.com/AlphixFi"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground transition-colors"
        >
          Contact us here!
        </a>
      </>
    ),
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
