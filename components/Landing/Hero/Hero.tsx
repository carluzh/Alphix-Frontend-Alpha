'use client'

import { cn } from '@/lib/utils'
import { useInView } from '@/hooks/useInView'
import Image from 'next/image'
import { PropsWithChildren, ReactNode } from 'react'
import { SonicBoom } from './SonicBoom'

export type HeroProps = PropsWithChildren<{
  className?: string
  title: ReactNode
  description: string
}>

export const Hero = ({
  className,
  title,
  description,
  children,
}: HeroProps) => {
  const { ref, inView } = useInView<HTMLDivElement>({ once: true, threshold: 0.1 })

  return (
    <div
      ref={ref}
      className={cn(
        'relative flex flex-col items-center justify-center gap-4 px-4 pt-8 text-center md:pt-12',
        className,
      )}
    >
      <div className={`hero-animate z-0 ${inView ? 'in-view hero-lines' : ''}`}>
        <SonicBoom />
      </div>
      <div className={`hero-animate relative z-10 ${inView ? 'in-view hero-logo' : ''}`}>
        <Image
          src="/LogoIconWhite.svg"
          alt="Alphix Logo"
          width={80}
          height={80}
          className="dark:block"
          priority
        />
      </div>
      <h1
        className={`hero-animate relative z-10 text-2xl leading-tight tracking-tight text-balance md:px-0 md:text-4xl ${inView ? 'in-view hero-title' : ''}`}
      >
        {title}
      </h1>
      <p
        className={`hero-animate relative z-10 max-w-xl text-center text-lg leading-relaxed text-balance text-muted-foreground ${inView ? 'in-view hero-desc' : ''}`}
      >
        {description}
      </p>
      <div
        className={`hero-animate relative z-10 mt-6 flex flex-col items-center gap-4 md:flex-row md:gap-6 ${inView ? 'in-view hero-cta' : ''}`}
      >
        {children}
      </div>
    </div>
  )
}
