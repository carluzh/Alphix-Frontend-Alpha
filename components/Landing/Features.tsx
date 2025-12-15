import { cn } from '@/lib/utils'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight } from 'lucide-react'

const UNISWAP_PINK = '#ff37c7'
const UNISWAP_LOGO_FILTER = 'brightness(0) saturate(100%) invert(47%) sepia(95%) saturate(2158%) hue-rotate(301deg) brightness(101%) contrast(101%)'

const UniswapFoundationCard = () => {
  return (
    <div
      className="animate-on-scroll flex flex-1 flex-col gap-y-6"
    >
      <Link
        href="https://docs.uniswap.org/contracts/v4/concepts/hooks"
        target="_blank"
        className="relative flex h-full flex-col justify-between gap-x-4 gap-y-4 rounded-lg p-6 transition-transform hover:translate-y-[-4px] md:gap-x-6 md:gap-y-6 md:p-10 xl:gap-y-0 overflow-hidden bg-[rgba(252,114,255,0.12)] hover:bg-[rgba(252,114,255,0.20)] transition-colors duration-300 ease-out"
      >
      <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/4 pointer-events-none">
        <Image
          src="/uniswap-logo.svg"
          alt=""
          width={280}
          height={280}
          style={{ opacity: 0.25 }}
          unoptimized
        />
      </div>

      <div className="flex h-full flex-col gap-y-6 relative z-10">
        <div className="flex items-center gap-x-2">
          <Image
            src="/uniswap-logo.svg"
            alt="Uniswap"
            width={28}
            height={28}
            style={{
              filter: UNISWAP_LOGO_FILTER
            }}
            unoptimized
          />
          <span className="text-lg font-semibold" style={{ color: UNISWAP_PINK }}>
            Uniswap
          </span>
        </div>

        <div className="flex h-full flex-col gap-y-2">
          <h3
            className="text-2xl font-semibold md:text-[28px] md:leading-tight"
            style={{ color: UNISWAP_PINK }}
          >
            A Secure Foundation
          </h3>
          <p
            className="w-full grow text-lg font-medium leading-6 md:max-w-96"
            style={{ color: UNISWAP_PINK }}
          >
            We use Hooks to bring smarter markets to production on battle-tested infrastructure.
          </p>
        </div>

        <div
          className="hidden md:flex items-center justify-center gap-2 rounded-3xl px-4 py-3 w-fit mt-2"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.25)' }}
        >
          <span className="text-sm font-semibold" style={{ color: UNISWAP_PINK }}>
            Learn More
          </span>
          <ArrowRight className="h-5 w-5" style={{ color: UNISWAP_PINK }} />
        </div>
      </div>
    </Link>
  </div>
  )
}

const BASE_BLUE = '#3c8aff'
const BASE_LOGO_FILTER = 'brightness(0) saturate(100%) invert(55%) sepia(57%) saturate(2159%) hue-rotate(199deg) brightness(101%) contrast(101%)'

const BaseChainCard = () => {
  return (
    <div
      className="animate-on-scroll flex flex-1 flex-col gap-y-6 delay-1"
    >
      <Link
        href="https://x.com/AlphixFi/status/1947334206528307690"
        target="_blank"
        className="group relative flex h-full flex-col justify-between gap-x-4 gap-y-4 rounded-lg p-6 transition-transform hover:translate-y-[-4px] md:gap-x-6 md:gap-y-6 md:p-10 xl:gap-y-0 overflow-hidden bg-[rgba(60,138,255,0.12)]"
      >
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.15] transition-opacity duration-300 group-hover:opacity-[0.6]"
          style={{
            backgroundImage: 'url(/base_back.webp)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
        <div className="flex h-full flex-col gap-y-6 relative z-10">
          <div className="flex items-center relative">
            <Image
              src="/base-lockup-white.svg"
              alt="Base"
              width={85}
              height={22}
                style={{ filter: BASE_LOGO_FILTER }}
                className="opacity-100 transition-opacity duration-300 group-hover:opacity-0"
              unoptimized
            />
            <Image
              src="/base-lockup-white.svg"
              alt=""
              width={85}
              height={22}
                className="absolute left-0 top-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              unoptimized
            />
          </div>

          <div className="flex h-full flex-col gap-y-2">
            <h3
              className="text-2xl font-semibold md:text-[28px] md:leading-tight text-[#3c8aff] transition-colors duration-300 group-hover:text-white"
            >
              Launching on Base
            </h3>
            <p
              className="w-full grow text-lg font-medium leading-6 md:max-w-96 text-[#3c8aff] transition-colors duration-300 group-hover:text-white"
            >
              Fast execution, deep liquidity, and real competition to prove our edge.
            </p>
          </div>

          <div
            className="hidden md:flex items-center justify-center gap-2 rounded-3xl px-4 py-3 w-fit mt-2"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.25)' }}
          >
            <span
              className="text-sm font-semibold text-[#3c8aff] transition-colors duration-300 group-hover:text-white"
            >
              Learn More
            </span>
            <ArrowRight
              className="h-5 w-5 text-[#3c8aff] transition-colors duration-300 group-hover:text-white"
            />
          </div>
        </div>
      </Link>
    </div>
  )
}

type FeaturesProps = {
  className?: string
}

const Features = ({ className }: FeaturesProps) => (
  <section className={cn('w-full', className)}>
    <div className="flex w-full flex-col gap-4 md:gap-6 xl:flex-row">
      <UniswapFoundationCard />
      <BaseChainCard />
    </div>
  </section>
)

export default Features
