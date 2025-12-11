'use client'

import dynamic from 'next/dynamic'
import { Hero } from '@/components/Landing/Hero/Hero'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import Features from './Features'
import { Section } from './Section'
import LandingLayout from './LandingLayout'
import { FeatureCards } from './FeatureCards'
import { SplitPromo } from './SplitPromo'
import { ArrowUpRight, Layers, Lock, SlidersVertical, Handshake, Repeat, BetweenVerticalStart, FileStack, ScanEye, ToyBrick, LucideIcon } from 'lucide-react'
import { useInView } from '@/hooks/useInView'
import { GlitchIcon } from './GlitchIcon'
import Image from 'next/image'

// Lazy load heavy components to reduce initial bundle
// DynamicFeeSection: ~45KB (recharts + animation logic)
const DynamicFeeSection = dynamic(
  () => import('./DynamicFeeSection').then(mod => mod.DynamicFeeSection),
  { ssr: false }
)

// PaperShaderFrame: ~25KB (WebGL shader)
const PaperShaderFrame = dynamic(
  () => import('./PaperShaderFrame').then(mod => mod.PaperShaderFrame),
  { ssr: false }
)

// Icon configuration: either a Lucide icon (censored) or a revealed feature image
type IconConfig =
  | { type: 'censored'; icon: LucideIcon }
  | { type: 'revealed'; image: string; alt: string; size?: 'default' | 'lg' }

const modularityIcons: IconConfig[] = [
  { type: 'censored', icon: SlidersVertical },
  { type: 'censored', icon: Handshake },
  { type: 'revealed', image: '/landing/FeatureIcons/dynamic.png', alt: 'Dynamic', size: 'lg' },
  { type: 'revealed', image: '/landing/FeatureIcons/refresh.png', alt: 'Refresh' },
  { type: 'censored', icon: Repeat },
  { type: 'censored', icon: BetweenVerticalStart },
  { type: 'censored', icon: FileStack },
  { type: 'censored', icon: ScanEye },
  { type: 'censored', icon: ToyBrick },
  { type: 'censored', icon: Layers },
  { type: 'censored', icon: Lock },
]

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
    description: 'Consolidated features in a single pool. Efficient, not fragmented.',
    image: '/landing/Unified-Pool.webp',
    imageClassName: 'translate-x-[5%]',
  },
  {
    title: 'Dynamic Fees',
    description: 'Fees that adapt in real-time to market conditions and competition.',
    image: '/landing/Dynamic-Fees.webp',
  },
  {
    title: 'Rehypothecation',
    description: 'Idle liquidity put to work across external partner protocols.',
    image: '/landing/Rehypothecation.webp',
    imageClassName: 'translate-x-[5%]',
  },
]

const ModularityCard = () => {
  const { ref, inView } = useInView<HTMLDivElement>({ once: true, threshold: 0.1 })

  return (
    <div
      ref={ref}
      className={`animate-on-scroll w-full overflow-hidden rounded-lg border border-sidebar-border/60 bg-white dark:bg-[#131313] p-2 ${inView ? 'in-view' : ''}`}
    >
      <div className="flex flex-row items-center">
        <div className="shrink-0 pl-2 pr-4 py-2 max-w-[200px] md:max-w-[280px]">
          <p className="text-xs md:text-sm text-muted-foreground leading-relaxed">
            <span className="text-foreground font-medium">Modular by design.</span>
            <br />
            Unified Pools enable seamless feature expansion as we scale.
          </p>
        </div>

        <div
          className="relative flex-1 overflow-hidden censor-marquee-container"
          style={{
            maskImage: 'linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%)',
          }}
        >
          <div className="flex animate-marquee-smooth-lg">
            {modularityIcons.map((config, index) => (
              <div
                key={index}
                className={`flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-lg mx-1 bg-gray-50 dark:bg-[#1a1a1a] ${config.type === 'revealed' ? 'border border-sidebar-border/60' : ''}`}
              >
                {config.type === 'censored' ? (
                  <GlitchIcon icon={config.icon} className="h-[18px] w-[18px] text-muted-foreground" glitchIndex={(index % 8) + 1} pixelScale={0.75} />
                ) : (
                  <Image src={config.image} alt={config.alt} width={18} height={18} className={config.size === 'lg' ? 'feature-icon-revealed-lg' : 'feature-icon-revealed'} />
                )}
              </div>
            ))}
            {modularityIcons.map((config, index) => (
              <div
                key={`dup-${index}`}
                className={`flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-lg mx-1 bg-gray-50 dark:bg-[#1a1a1a] ${config.type === 'revealed' ? 'border border-sidebar-border/60' : ''}`}
              >
                {config.type === 'censored' ? (
                  <GlitchIcon icon={config.icon} className="h-[18px] w-[18px] text-muted-foreground" glitchIndex={(index % 8) + 1} pixelScale={0.75} />
                ) : (
                  <Image src={config.image} alt={config.alt} width={18} height={18} className={config.size === 'lg' ? 'feature-icon-revealed-lg' : 'feature-icon-revealed'} />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

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
            <Button size="lg" className="rounded-md font-semibold transition-all bg-button-primary text-sidebar-primary border border-sidebar-primary hover-button-primary">
              Launch App
            </Button>
          </Link>
          <Link href="https://alphix.gitbook.io/docs/" target="_blank">
            <button className="group relative rounded-md border border-sidebar-border bg-button px-8 py-2.5 text-sm font-semibold text-foreground hover:bg-accent hover:brightness-110 hover:border-white/30 transition-all overflow-hidden">
              <span
                className="absolute inset-0 transition-opacity duration-200 group-hover:opacity-0"
                style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
              />
              <span className="relative z-10">Learn More</span>
            </button>
          </Link>
        </Hero>

        <FeatureCards features={heroFeatures} />
      </Section>

      <Section className="flex flex-col gap-y-12 mt-8">
        <DynamicFeeSection />

        <SplitPromo
          title="More Yield for Everyone"
          description="Through Rehypothecation, idle liquidity is put to work across trusted yield-generating protocols."
          bullets={[
            'Increased yield on liquidity positions',
            'Leading protocol integrations to maximize security',
            'Seamless LP experience',
          ]}
          image="/landing/example.webp"
          reverse
          badge={{ text: 'In Development', variant: 'muted' }}
          cta1={
            <button
              disabled
              className="flex flex-row items-center gap-x-2 rounded-md bg-accent/50 px-6 py-2.5 text-sm font-semibold text-muted-foreground cursor-default"
            >
              Learn More
              <ArrowUpRight className="h-4 w-4" />
            </button>
          }
        />

        <ModularityCard />

        <Features />
      </Section>

    </>
  )
}
