'use client'

import { useInView } from '@/hooks/useInView'
import { Check } from 'lucide-react'
import Image from 'next/image'
import React from 'react'

interface SplitPromoProps {
  title: string
  description: string
  bullets?: string[]
  cta1?: React.ReactNode
  cta2?: React.ReactNode
  image: string
  reverse?: boolean
  badge?: {
    text: string
    variant?: 'default' | 'muted'
  }
}

export const SplitPromo: React.FC<SplitPromoProps> = ({
  title,
  description,
  bullets,
  cta1,
  cta2,
  image,
  reverse = false,
  badge,
}) => {
  const { ref, inView } = useInView<HTMLDivElement>({ once: true, threshold: 0.1 })

  return (
    <div
      ref={ref}
      className={`animate-on-scroll flex w-full flex-col gap-y-6 overflow-hidden rounded-lg border border-sidebar-border/60 bg-white dark:bg-[#131313] p-2 xl:flex-row ${reverse ? 'xl:flex-row-reverse' : ''} ${inView ? 'in-view' : ''}`}
    >
      {/* Text Content */}
      <div className="flex w-full flex-1 flex-col gap-y-8 p-6 md:p-12">
        <div className="flex flex-col gap-y-4">
          {badge && (
            <span
              className={`w-fit rounded-md px-2.5 py-1 text-xs font-medium ${
                badge.variant === 'muted'
                  ? 'bg-gray-100 dark:bg-[#1a1a1a] text-muted-foreground'
                  : 'bg-green-950/70 text-green-500'
              }`}
            >
              {badge.text}
            </span>
          )}
          <h2 className="text-3xl font-semibold leading-tight text-balance md:text-4xl">
            {title}
          </h2>
        </div>
        <p className="text-lg leading-relaxed text-pretty text-muted-foreground">
          {description}
        </p>
        {bullets && bullets.length > 0 && (
          <ul className="flex flex-col gap-y-1">
            {bullets.map((bullet, index) => (
              <li
                key={index}
                className="flex flex-row items-center gap-x-2"
              >
                <Check className="h-4 w-4 text-green-500 shrink-0" />
                <p className="leading-relaxed text-pretty text-foreground">{bullet}</p>
              </li>
            ))}
          </ul>
        )}
        <div className="hidden md:flex flex-row items-center gap-x-6">
          {cta1}
          {cta2}
        </div>
      </div>
      {/* Image Container - nested rounded box like DynamicFeeSection */}
      <div className="flex w-full flex-1 flex-col rounded-lg bg-gray-50 dark:bg-[#161616] overflow-hidden">
        <div className="relative flex w-full h-full min-h-[200px] md:min-h-[300px]">
          <Image
            className="absolute inset-0 h-full w-full object-cover object-center"
            src={image}
            fill
            sizes="(max-width: 768px) 100vw, 50vw"
            loading="lazy"
            alt={title}
          />
        </div>
      </div>
    </div>
  )
}
