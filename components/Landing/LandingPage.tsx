import { Hero } from '@/components/Landing/Hero/Hero'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import Features from './Features'
import { FAQSection } from './FAQSection'
import { Section } from './Section'
import LandingLayout from './LandingLayout'
import { FeatureCards } from './FeatureCards'
import { ProtocolStatsBar } from './ProtocolStatsBar'
import { SectionHeading } from './SectionHeading'
import { SplitPromo } from './SplitPromo'
import { ArrowUpRight } from 'lucide-react'
import { GlitchIcon, type GlitchIconName } from './GlitchIcon'
import Image from 'next/image'
import { DynamicFeeSectionLazy, LandingInViewInit, PaperShaderFrameLazy } from './LandingClient'
type IconConfig =
  | { type: 'censored'; iconName: GlitchIconName }
  | { type: 'revealed'; image: string; alt: string; size?: 'default' | 'lg' }

const modularityIcons: IconConfig[] = [
  { type: 'censored', iconName: 'SlidersVertical' },
  { type: 'censored', iconName: 'Handshake' },
  { type: 'revealed', image: '/landing/feature-icons/dynamic.png', alt: 'Dynamic', size: 'lg' },
  { type: 'revealed', image: '/landing/feature-icons/refresh.png', alt: 'Refresh' },
  { type: 'censored', iconName: 'Repeat' },
  { type: 'censored', iconName: 'BetweenVerticalStart' },
  { type: 'censored', iconName: 'FileStack' },
  { type: 'censored', iconName: 'ScanEye' },
  { type: 'censored', iconName: 'ToyBrick' },
  { type: 'censored', iconName: 'Layers' },
  { type: 'censored', iconName: 'Lock' },
]

export default function LandingPage() {

  return (
    <LandingLayout>
      <LandingInViewInit />
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

const manageFeatures = [
  {
    title: 'Continuous Rebalancing',
    description: 'Positions adjust to volatility and price without manual intervention.',
    image: '/landing/Dynamic-Fees.webp',
    imageClassName: 'translate-x-[5%]',
  },
  {
    title: 'Auto-Compounding',
    description: 'Earned fees reinvest into the pool, compounding yield automatically.',
    image: '/landing/Rehypothecation.webp',
  },
  {
    title: 'MEV Rebate',
    description: 'Value otherwise lost to external bots is captured and returned.',
    image: '/landing/Unified-Pool.webp',
    imageClassName: 'translate-x-[5%]',
  },
]

const RevealedIcon = ({ src, alt, size }: { src: string; alt: string; size?: 'default' | 'lg' }) => {
  const sizeClass = size === 'lg' ? 'w-[23px] h-[23px]' : 'w-[19px] h-[19px]'
  return (
    <>
      {/* Desktop: use Image with CSS filter */}
      <Image
        src={src}
        alt={alt}
        width={18}
        height={18}
        className={`hidden md:block ${size === 'lg' ? 'feature-icon-revealed-lg' : 'feature-icon-revealed'}`}
        unoptimized
      />
      {/* Mobile: use mask-image with background color (more reliable) */}
      <div
        className={`md:hidden ${sizeClass}`}
        style={{
          backgroundColor: '#F45502',
          maskImage: `url(${src})`,
          WebkitMaskImage: `url(${src})`,
          maskSize: 'contain',
          WebkitMaskSize: 'contain',
          maskRepeat: 'no-repeat',
          WebkitMaskRepeat: 'no-repeat',
          maskPosition: 'center',
          WebkitMaskPosition: 'center',
          filter: 'drop-shadow(0 0 4px rgba(244, 85, 2, 0.25))',
        }}
      />
    </>
  )
}

const ModularityCard = () => {
  const MarqueeContent = ({ iconSize, boxSize }: { iconSize: string; boxSize: string }) => (
    <>
      {modularityIcons.map((config, index) => (
        <div
          key={index}
          className={`flex ${boxSize} shrink-0 items-center justify-center rounded-lg mx-1 bg-gray-50 dark:bg-[#1a1a1a] ${config.type === 'revealed' ? 'border border-sidebar-border/60' : ''}`}
        >
          {config.type === 'censored' ? (
            <GlitchIcon iconName={config.iconName} className={`${iconSize} text-muted-foreground`} glitchIndex={(index % 8) + 1} pixelScale={0.75} />
          ) : (
            <RevealedIcon src={config.image} alt={config.alt} size={config.size} />
          )}
        </div>
      ))}
      {modularityIcons.map((config, index) => (
        <div
          key={`dup-${index}`}
          className={`flex ${boxSize} shrink-0 items-center justify-center rounded-lg mx-1 bg-gray-50 dark:bg-[#1a1a1a] ${config.type === 'revealed' ? 'border border-sidebar-border/60' : ''}`}
        >
          {config.type === 'censored' ? (
            <GlitchIcon iconName={config.iconName} className={`${iconSize} text-muted-foreground`} glitchIndex={(index % 8) + 1} pixelScale={0.75} />
          ) : (
            <RevealedIcon src={config.image} alt={config.alt} size={config.size} />
          )}
        </div>
      ))}
    </>
  )

  return (
    <div
      className="animate-on-scroll w-full overflow-hidden rounded-lg border border-sidebar-border/60 bg-white dark:bg-[#131313] p-2"
    >
      <div className="flex flex-col md:hidden">
        <div className="px-4 py-3">
          <p className="text-sm text-muted-foreground leading-relaxed">
            <span className="text-foreground font-medium">Built around the token.</span>
            {' '}Our pools run a feature set customized to the protocol&rsquo;s profile.
          </p>
        </div>
        <div
          className="relative w-full overflow-hidden censor-marquee-container"
          style={{
            maskImage: 'linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%)',
          }}
        >
          <div className="flex animate-marquee-smooth-lg">
            <MarqueeContent iconSize="h-[16px] w-[16px]" boxSize="h-[60px] w-[60px]" />
          </div>
        </div>
      </div>

      <div className="hidden md:flex flex-row items-center">
        <div className="shrink-0 pl-2 pr-4 py-2 max-w-[280px]">
          <p className="text-sm text-muted-foreground leading-relaxed">
            <span className="text-foreground font-medium">Built around the token.</span>
            <br />
            Our pools run a feature set customized to the protocol&rsquo;s profile.
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
            <MarqueeContent iconSize="h-[18px] w-[18px]" boxSize="h-[72px] w-[72px]" />
          </div>
        </div>
      </div>
    </div>
  )
}

export const PageContent = () => {
  return (
    <>
      <Section className="relative flex flex-col gap-y-10 md:gap-y-16 py-0 md:py-0">
        <PaperShaderFrameLazy />
        <Hero
          title="The Non-Custodial Market Maker for Onchain Protocols"
          description={
            <>
              Onchain liquidity is complex, but protocols need deep, efficient pools. We build the pool and manage it.{' '}
              <em className="italic">Permissionless. Simple. Secure.</em>
            </>
          }
        >
          <Link href="/home">
            <Button
              size="lg"
              data-hero-cta
              className="rounded-md font-semibold transition-all bg-button-primary text-sidebar-primary border border-sidebar-primary hover-button-primary"
            >
              Launch App
            </Button>
          </Link>
          <Link href="https://alphix.gitbook.io/docs/" target="_blank">
            <button className="group relative rounded-md border border-sidebar-border bg-button px-8 py-2.5 text-sm font-semibold text-foreground hover:bg-accent hover:brightness-110 hover:border-white/30 transition-all overflow-hidden">
              <span
                className="absolute inset-0 transition-opacity duration-200 group-hover:opacity-0"
                style={{ backgroundImage: 'url(/patterns/button-default.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
              />
              <span className="relative z-10">Learn More</span>
            </button>
          </Link>
        </Hero>

        <div
          className="relative z-10 h-px w-full max-w-5xl mx-auto -my-5 md:-my-8"
          style={{
            backgroundImage:
              'repeating-linear-gradient(90deg, rgba(255,255,255,0.25) 0, rgba(255,255,255,0.25) 4px, transparent 4px, transparent 7px)',
            maskImage:
              'linear-gradient(to right, transparent 0%, rgba(0,0,0,0.8) 15%, rgba(0,0,0,0.5) 50%, rgba(0,0,0,0.8) 85%, transparent 100%)',
            WebkitMaskImage:
              'linear-gradient(to right, transparent 0%, rgba(0,0,0,0.8) 15%, rgba(0,0,0,0.5) 50%, rgba(0,0,0,0.8) 85%, transparent 100%)',
          }}
        />

        <ProtocolStatsBar />
      </Section>

      <Section className="flex flex-col gap-y-8 md:gap-y-12 py-0 md:py-0 mt-16 md:mt-24">
        <SectionHeading title="The Pool" badge={{ text: 'Live', variant: 'live' }} className="-mb-4 md:-mb-6" />

        <FeatureCards features={heroFeatures} />

        <div className="min-h-[700px] md:min-h-[520px] xl:min-h-[480px]">
          <DynamicFeeSectionLazy />
        </div>

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
          badge={{ text: 'Live', variant: 'active' }}
          cta1={
            <Link href="https://alphix.gitbook.io/docs/" target="_blank">
              <button className="group relative flex flex-row items-center gap-x-2 rounded-md border border-sidebar-border bg-button px-8 py-2.5 text-sm font-semibold text-foreground hover:bg-accent hover:brightness-110 hover:border-white/30 transition-all overflow-hidden">
                <span
                  className="absolute inset-0 transition-opacity duration-200 group-hover:opacity-0"
                  style={{ backgroundImage: 'url(/patterns/button-default.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
                />
                <span className="relative z-10">Learn More</span>
                <ArrowUpRight className="relative z-10 h-4 w-4" />
              </button>
            </Link>
          }
        />

        <ModularityCard />

        {/* Manager section hidden
        <SectionHeading title="The Manager" badge={{ text: 'In Development', variant: 'dev' }} className="-mb-4 md:-mb-6" />

        <FeatureCards features={manageFeatures} />
        */}

        <Features />

        <FAQSection />
      </Section>

    </>
  )
}
