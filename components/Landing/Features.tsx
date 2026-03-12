'use client'

import { cn } from '@/lib/utils'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight } from 'lucide-react'

const UNISWAP_PINK = '#ff37c7'
const UNISWAP_LOGO_FILTER = 'brightness(0) saturate(100%) invert(47%) sepia(95%) saturate(2158%) hue-rotate(301deg) brightness(101%) contrast(101%)'
const BASE_BLUE = '#3c8aff'
const BASE_LOGO_FILTER = 'brightness(0) saturate(100%) invert(55%) sepia(57%) saturate(2159%) hue-rotate(199deg) brightness(101%) contrast(101%)'
const ARBITRUM_BLUE = '#12AAFF'
const ARBITRUM_LOGO_FILTER = 'brightness(0) saturate(100%) invert(58%) sepia(72%) saturate(2035%) hue-rotate(176deg) brightness(101%) contrast(101%)'

// ---------------------------------------------------------------------------
// Base Card
// ---------------------------------------------------------------------------

const BaseCard = () => (
  <div className="animate-on-scroll flex flex-1 flex-col">
    <Link
      href="https://x.com/AlphixFi/status/1947334206528307690"
      target="_blank"
      className="group relative flex h-full flex-col justify-between gap-y-4 rounded-lg p-6 md:p-10 overflow-hidden transition-transform hover:translate-y-[-4px]"
    >
      {/* Background — resting */}
      <div
        className="absolute inset-0 rounded-lg"
        style={{ background: 'rgba(60,138,255,0.12)' }}
      />
      {/* Base background image — subtle at rest */}
      <div
        className="absolute inset-0 rounded-lg pointer-events-none opacity-[0.15]"
        style={{
          backgroundImage: 'url(/landing/base-background.webp)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />
      {/* Base background image — hover layer */}
      <div
        className="absolute inset-0 rounded-lg pointer-events-none opacity-0 transition-opacity duration-300 group-hover:opacity-60"
        style={{
          backgroundImage: 'url(/landing/base-background.webp)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />

      {/* Content */}
      <div className="relative z-10 flex h-full flex-col gap-y-6">
        <div className="flex items-center relative">
          <Image
            src="/landing/base-lockup-white.svg"
            alt="Base"
            width={85}
            height={22}
            style={{ filter: BASE_LOGO_FILTER }}
            className="opacity-100 transition-opacity duration-300 group-hover:opacity-0"
            unoptimized
          />
          <Image
            src="/landing/base-lockup-white.svg"
            alt=""
            width={85}
            height={22}
            className="absolute left-0 top-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
            unoptimized
          />
        </div>

        <div className="flex h-full flex-col gap-y-2">
          <h3 className="text-2xl font-semibold md:text-[28px] md:leading-tight text-[#3c8aff] transition-colors duration-300 group-hover:text-white">
            Live on Base
          </h3>
          <p className="w-full grow text-lg font-medium leading-6 md:max-w-96 text-[#3c8aff] transition-colors duration-300 group-hover:text-white">
            Fast execution, deep liquidity, and real competition to prove our edge.
          </p>
        </div>

        <div
          className="hidden md:flex items-center justify-center gap-2 rounded-3xl px-4 py-3 w-fit mt-2"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.25)' }}
        >
          <span className="text-sm font-semibold text-[#3c8aff] transition-colors duration-300 group-hover:text-white">
            Learn More
          </span>
          <ArrowRight className="h-5 w-5 text-[#3c8aff] transition-colors duration-300 group-hover:text-white" />
        </div>
      </div>
    </Link>
  </div>
)

// ---------------------------------------------------------------------------
// Arbitrum Card
// ---------------------------------------------------------------------------

const ArbitrumCard = () => (
  <div className="animate-on-scroll flex flex-1 flex-col delay-1">
    <Link
      href="https://x.com/AlphixFi"
      target="_blank"
      className="group relative flex h-full flex-col justify-between gap-y-4 rounded-lg p-6 md:p-10 overflow-hidden transition-transform hover:translate-y-[-4px]"
    >
      {/* Background gradient — resting */}
      <div
        className="absolute inset-0 rounded-lg"
        style={{ background: 'linear-gradient(to bottom, rgba(1,107,229,0.15), rgba(5,22,61,0.15))' }}
      />
      {/* Hover gradient overlay */}
      <div
        className="absolute inset-0 rounded-lg pointer-events-none opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: 'linear-gradient(to bottom, #016BE5, #05163D)' }}
      />
      {/* Stripe pattern */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.035] transition-opacity duration-300 group-hover:opacity-[0.10]"
        style={{
          backgroundImage: 'url(/landing/arbitrum-stripes.svg)',
          backgroundSize: '80%',
          backgroundPosition: 'right center',
          backgroundRepeat: 'no-repeat',
        }}
      />

      {/* Content */}
      <div className="relative z-10 flex h-full flex-col gap-y-6">
        <div className="flex items-center relative">
          <Image
            src="/landing/arbitrum-lockup-white.svg"
            alt="Arbitrum"
            width={85}
            height={22}
            style={{ filter: ARBITRUM_LOGO_FILTER }}
            className="opacity-100 transition-opacity duration-300 group-hover:opacity-0"
            unoptimized
          />
          <Image
            src="/landing/arbitrum-lockup-white.svg"
            alt=""
            width={85}
            height={22}
            className="absolute left-0 top-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
            unoptimized
          />
        </div>

        <div className="flex h-full flex-col gap-y-2">
          <h3 className="text-2xl font-semibold md:text-[28px] md:leading-tight text-[#12AAFF] transition-colors duration-300 group-hover:text-white">
            Expanding to Arbitrum
          </h3>
          <p className="w-full grow text-lg font-medium leading-6 md:max-w-96 text-[#12AAFF] transition-colors duration-300 group-hover:text-white">
            Bringing smarter markets to Arbitrum&apos;s thriving DeFi ecosystem.
          </p>
        </div>

        <div
          className="hidden md:flex items-center justify-center gap-2 rounded-3xl px-4 py-3 w-fit mt-2"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.25)' }}
        >
          <span className="text-sm font-semibold text-[#12AAFF] transition-colors duration-300 group-hover:text-white">
            Learn More
          </span>
          <ArrowRight className="h-5 w-5 text-[#12AAFF] transition-colors duration-300 group-hover:text-white" />
        </div>
      </div>
    </Link>
  </div>
)

// ---------------------------------------------------------------------------
// Uniswap Card — full width, horizontal with Learn More on right
// ---------------------------------------------------------------------------

const UniswapFoundationCard = () => (
  <div className="animate-on-scroll delay-2">
    <Link
      href="https://docs.uniswap.org/contracts/v4/concepts/hooks"
      target="_blank"
      className="group relative flex flex-col md:flex-row md:items-center md:justify-between gap-4 rounded-lg p-6 md:px-10 md:py-8 overflow-hidden transition-transform hover:translate-y-[-4px] bg-[rgba(252,114,255,0.12)] hover:bg-[rgba(252,114,255,0.20)] transition-colors duration-300 ease-out"
    >
      {/* Background logo watermark */}
      <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-[15%] pointer-events-none">
        <Image
          src="/landing/uniswap-logo.svg"
          alt=""
          width={280}
          height={280}
          style={{ opacity: 0.2 }}
          unoptimized
        />
      </div>

      {/* Left: logo + title + description stacked */}
      <div className="relative z-10 flex flex-col gap-y-2">
        <div className="flex items-center gap-x-2">
          <Image
            src="/landing/uniswap-logo.svg"
            alt="Uniswap"
            width={28}
            height={28}
            style={{ filter: UNISWAP_LOGO_FILTER }}
            unoptimized
          />
          <span className="text-lg font-semibold" style={{ color: UNISWAP_PINK }}>
            Uniswap
          </span>
        </div>

        <h3
          className="text-xl font-semibold md:text-2xl"
          style={{ color: UNISWAP_PINK }}
        >
          A Secure Foundation
        </h3>
        <p
          className="text-base font-medium leading-6 md:max-w-[520px]"
          style={{ color: UNISWAP_PINK }}
        >
          We use Hooks to bring smarter markets to production on battle-tested infrastructure.
        </p>
      </div>

      {/* Right: Learn More */}
      <div
        className="relative z-10 hidden md:flex items-center justify-center gap-2 rounded-3xl px-6 py-3 shrink-0"
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.25)' }}
      >
        <span className="text-base font-semibold" style={{ color: UNISWAP_PINK }}>
          Learn More
        </span>
        <ArrowRight className="h-5 w-5" style={{ color: UNISWAP_PINK }} />
      </div>
    </Link>
  </div>
)

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

type FeaturesProps = {
  className?: string
}

const Features = ({ className }: FeaturesProps) => (
  <section className={cn('w-full', className)}>
    <div className="flex w-full flex-col gap-4 md:gap-6">
      {/* Row 1: Base + Arbitrum side by side */}
      <div className="flex w-full flex-col gap-4 md:gap-6 xl:flex-row">
        <BaseCard />
        <ArbitrumCard />
      </div>
      {/* Row 2: Uniswap full width */}
      <UniswapFoundationCard />
    </div>
  </section>
)

export default Features
