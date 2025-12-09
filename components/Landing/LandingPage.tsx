'use client'

import { Hero } from '@/components/Landing/Hero/Hero'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import Features from './Features'
import { Section } from './Section'
import LandingLayout from './LandingLayout'
import { FeatureCards } from './FeatureCards'
import { SplitPromo } from './SplitPromo'
import { DynamicFeeSection } from './DynamicFeeSection'
import { PaperShaderFrame } from './PaperShaderFrame'
import { ArrowUpRight } from 'lucide-react'

export default function LandingPage() {
  return (
    <LandingLayout>
      <div className="flex flex-col">
        <PageContent />
      </div>
    </LandingLayout>
  )
}

const heroFeatures = [
  {
    title: 'Unified Pools',
    description: 'Consolidate features into single pools. Efficient, not fragmented.',
    image: '/pattern.svg',
  },
  {
    title: 'Dynamic Fees',
    description: 'Fees that adapt in real-time to market volatility and conditions.',
    image: '/pattern.svg',
  },
  {
    title: 'Rehypothecation',
    description: 'Idle liquidity put to work across integrated external protocols.',
    image: '/pattern.svg',
  },
]

export const PageContent = () => {
  return (
    <>
      <Section className="relative flex flex-col gap-y-16 py-0 md:py-0">
        <PaperShaderFrame />
        <Hero
          title="Building smarter onchain markets."
          description="Our Unified Pools compound innovation into one secure pool. Empowering liquidity instead of fragmenting it."
        >
          <Link href="/swap">
            <Button size="lg" className="rounded-md font-semibold transition-all bg-button-primary text-sidebar-primary hover:bg-[#2d1c12] hover:text-[#d84a02]">
              Launch App
            </Button>
          </Link>
          <Link href="https://alphix.gitbook.io/docs/" target="_blank">
            <Button
              size="lg"
              className="rounded-md bg-muted/50 text-muted-foreground hover:bg-muted/70 hover:text-white"
            >
              Learn More
            </Button>
          </Link>
        </Hero>

        <FeatureCards features={heroFeatures} />
      </Section>

      <Section className="flex flex-col gap-y-16 mt-8">
        <DynamicFeeSection />

        <SplitPromo
          title="Unified Pool Architecture"
          description="Experience the next generation of AMM design. Our unified pools consolidate multiple features into a single, efficient structure."
          bullets={[
            'Composable hook system',
            'Reduced fragmentation',
            'Enhanced capital efficiency',
            'Future-proof design',
          ]}
          image="/pattern_wide.svg"
          reverse
          cta1={
            <Link href="/liquidity">
              <Button className="rounded-full bg-black text-white hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200">
                Provide Liquidity
                <ArrowUpRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          }
        />
      </Section>

      <Section className="flex flex-col gap-y-16">
        <Features />
      </Section>

      <Section className="flex flex-col gap-y-16">
        <div className="flex flex-col items-center text-center gap-y-8">
          <h2 className="text-3xl md:text-5xl leading-normal text-pretty">
            Ready to get started?
          </h2>
          <p className="text-lg text-gray-500 dark:text-gray-400 max-w-2xl">
            Join the next generation of decentralized trading.
          </p>
          <div className="flex flex-col md:flex-row gap-4 mt-4">
            <Link href="/swap">
              <Button size="lg" className="rounded-full bg-black text-white hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200">
                Start Trading
              </Button>
            </Link>
            <Link href="/liquidity">
              <Button
                variant="secondary"
                size="lg"
                className="rounded-full bg-white dark:bg-[#141413] border border-gray-200 dark:border-gray-700"
              >
                Provide Liquidity
              </Button>
            </Link>
          </div>
        </div>
      </Section>
    </>
  )
}
