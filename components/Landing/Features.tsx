'use client'

import { cn } from '@/lib/utils'
import { motion } from 'framer-motion'
import Link from 'next/link'
import React from 'react'
import {
  TrendingUp,
  Zap,
  Shield,
  Layers,
  LineChart,
  RefreshCw
} from 'lucide-react'

type FeatureCardProps = {
  title: string
  description: string | React.ReactNode
  linkHref: string
  className?: string
  children?: React.ReactNode
}

const FeatureCard = ({
  title,
  description,
  linkHref,
  className,
  children,
}: FeatureCardProps) => {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { duration: 2 } },
      }}
      className={cn('flex flex-col gap-y-6', className)}
    >
      <Link
        href={linkHref}
        target={linkHref.startsWith('http') ? '_blank' : undefined}
        className="bg-white dark:bg-[#141413] flex h-full flex-col justify-between gap-x-6 gap-y-6 rounded-2xl p-6 transition-transform hover:translate-y-[-4px] md:p-10 xl:gap-y-0"
      >
        <div className="flex h-full flex-col gap-y-6">
          <div className="flex h-full flex-col gap-y-2 md:gap-y-6">
            <h3 className="text-xl text-pretty md:text-3xl md:leading-tight">
              {title}
            </h3>
            {typeof description === 'string' ? (
              <p className="w-full grow text-lg text-gray-500 dark:text-gray-400 md:max-w-96">
                {description}
              </p>
            ) : (
              description
            )}
          </div>
        </div>
        {children}
      </Link>
    </motion.div>
  )
}

type FeaturesProps = {
  className?: string
}

const Features = ({ className }: FeaturesProps) => {
  const features = [
    {
      title: 'Dynamic Fees',
      description:
        'Our adaptive fee algorithm responds to market conditions in real-time, optimizing returns for liquidity providers.',
      linkHref: '/swap',
      children: (
        <div className="grid grid-cols-2 gap-2">
          {[
            {
              icon: <TrendingUp className="h-4 w-4" />,
              text: 'Adaptive Pricing',
            },
            {
              icon: <LineChart className="h-4 w-4" />,
              text: 'Real-time Data',
            },
            {
              icon: <Zap className="h-4 w-4" />,
              text: 'Capital Efficient',
            },
            {
              icon: <RefreshCw className="h-4 w-4" />,
              text: 'Auto-adjusting',
            },
          ].map((item, i) => (
            <div
              key={i}
              className="bg-gray-50 dark:bg-[#1a1a19] flex items-center gap-x-3 rounded-lg px-3 py-2"
            >
              {item.icon}
              <span className="text-xs">
                {item.text}
              </span>
            </div>
          ))}
        </div>
      ),
    },
    {
      title: 'Unified Pools',
      description:
        'Consolidate multiple features into a single pool, reducing fragmentation and improving capital efficiency.',
      linkHref: '/liquidity',
      children: (
        <div className="grid grid-cols-2 gap-2">
          {[
            {
              icon: <Layers className="h-4 w-4" />,
              text: 'Composable',
            },
            {
              icon: <Shield className="h-4 w-4" />,
              text: 'Secure',
            },
          ].map((item, i) => (
            <div
              key={i}
              className="bg-gray-50 dark:bg-[#1a1a19] flex items-center gap-x-3 rounded-lg px-3 py-2"
            >
              {item.icon}
              <span className="text-xs">
                {item.text}
              </span>
            </div>
          ))}
        </div>
      ),
    },
    {
      title: 'Built on Uniswap V4',
      description:
        'Leveraging the most advanced AMM infrastructure with hooks for unprecedented customization.',
      linkHref: 'https://alphix.gitbook.io/docs/',
      children: (
        <div className="bg-gray-50 dark:bg-[#1a1a19] flex flex-col gap-y-2 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm">
              Infrastructure
            </span>
            <span className="text-sm text-emerald-500">Uniswap V4</span>
          </div>
          <div className="border-t border-gray-200 dark:border-gray-700 flex items-center justify-between pt-2">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Hook System
            </span>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Enabled
            </span>
          </div>
        </div>
      ),
    },
  ]

  return (
    <section className={className}>
      <motion.div
        initial="hidden"
        animate="visible"
        transition={{
          staggerChildren: 0.1,
        }}
        className="flex flex-col gap-4 md:gap-8 xl:flex-row"
      >
        {features.map((feature, index) => (
          <FeatureCard
            key={index}
            title={feature.title}
            description={feature.description}
            linkHref={feature.linkHref}
          >
            {feature.children}
          </FeatureCard>
        ))}
      </motion.div>
    </section>
  )
}

export default Features
