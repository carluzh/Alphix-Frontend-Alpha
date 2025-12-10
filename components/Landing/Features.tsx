'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { motion } from 'framer-motion'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight } from 'lucide-react'

const UNISWAP_PINK = '#ff37c7'
const UNISWAP_LOGO_FILTER = 'brightness(0) saturate(100%) invert(47%) sepia(95%) saturate(2158%) hue-rotate(301deg) brightness(101%) contrast(101%)'

const UniswapFoundationCard = () => {
  const [isHovered, setIsHovered] = useState(false)

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 20 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.8 } },
      }}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true }}
      className="flex flex-1 flex-col gap-y-6"
    >
      <Link
        href="https://docs.uniswap.org/contracts/v4/overview"
        target="_blank"
        className="relative flex h-full flex-col justify-between gap-x-6 gap-y-6 rounded-lg p-6 transition-transform hover:translate-y-[-4px] md:p-10 xl:gap-y-0 overflow-hidden"
        style={{
          backgroundColor: isHovered ? 'rgba(252, 114, 255, 0.20)' : 'rgba(252, 114, 255, 0.12)',
          transition: 'background-color 0.3s ease'
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
      <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/4 pointer-events-none">
        <Image
          src="/uniswap-logo.svg"
          alt=""
          width={280}
          height={280}
          style={{ opacity: 0.25 }}
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
          className="flex items-center justify-center gap-2 rounded-3xl px-4 py-3 w-fit mt-2"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.25)' }}
        >
          <span className="text-sm font-semibold" style={{ color: UNISWAP_PINK }}>
            Learn More
          </span>
          <ArrowRight className="h-5 w-5" style={{ color: UNISWAP_PINK }} />
        </div>
      </div>
    </Link>
  </motion.div>
  )
}

const BASE_BLUE = '#3c8aff'
const BASE_LOGO_FILTER = 'brightness(0) saturate(100%) invert(55%) sepia(57%) saturate(2159%) hue-rotate(199deg) brightness(101%) contrast(101%)'

const BaseChainCard = () => {
  const [isHovered, setIsHovered] = useState(false)

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 20 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.8 } },
      }}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true }}
      className="flex flex-1 flex-col gap-y-6"
    >
      <Link
        href="https://base.org"
        target="_blank"
        className="relative flex h-full flex-col justify-between gap-x-6 gap-y-6 rounded-lg p-6 transition-transform hover:translate-y-[-4px] md:p-10 xl:gap-y-0 overflow-hidden"
        style={{ backgroundColor: 'rgba(60, 138, 255, 0.12)' }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: 'url(/base_back.png)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            opacity: isHovered ? 0.6 : 0.15,
            transition: 'opacity 0.3s ease'
          }}
        />
        <div className="flex h-full flex-col gap-y-6 relative z-10">
          {/* Header with Base lockup - two layers for smooth color transition */}
          <div className="flex items-center relative">
            {/* Blue version (default) */}
            <Image
              src="/base-lockup-white.svg"
              alt="Base"
              width={85}
              height={22}
              style={{
                filter: BASE_LOGO_FILTER,
                opacity: isHovered ? 0 : 1,
                transition: 'opacity 0.3s ease'
              }}
            />
            {/* White version (hover) */}
            <Image
              src="/base-lockup-white.svg"
              alt=""
              width={85}
              height={22}
              className="absolute left-0 top-0"
              style={{
                opacity: isHovered ? 1 : 0,
                transition: 'opacity 0.3s ease'
              }}
            />
          </div>

          {/* Title and description */}
          <div className="flex h-full flex-col gap-y-2">
            <h3
              className="text-2xl font-semibold md:text-[28px] md:leading-tight"
              style={{
                color: isHovered ? '#ffffff' : BASE_BLUE,
                transition: 'color 0.3s ease'
              }}
            >
              Launching on Base
            </h3>
            <p
              className="w-full grow text-lg font-medium leading-6 md:max-w-96"
              style={{
                color: isHovered ? '#ffffff' : BASE_BLUE,
                transition: 'color 0.3s ease'
              }}
            >
              Fast execution, deep liquidity, and real competition to prove our edge.
            </p>
          </div>

          {/* CTA button */}
          <div
            className="flex items-center justify-center gap-2 rounded-3xl px-4 py-3 w-fit mt-2"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.25)' }}
          >
            <span
              className="text-sm font-semibold"
              style={{
                color: isHovered ? '#ffffff' : BASE_BLUE,
                transition: 'color 0.3s ease'
              }}
            >
              Learn More
            </span>
            <ArrowRight
              className="h-5 w-5"
              style={{
                color: isHovered ? '#ffffff' : BASE_BLUE,
                transition: 'color 0.3s ease'
              }}
            />
          </div>
        </div>
      </Link>
    </motion.div>
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
