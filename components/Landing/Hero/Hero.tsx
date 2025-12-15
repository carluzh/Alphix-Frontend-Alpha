import { cn } from '@/lib/utils'
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
  return (
    <div
      className={cn(
        'relative flex flex-col items-center justify-center gap-4 px-4 pt-8 text-center md:pt-12',
        className,
      )}
    >
      <div className="hero-animate in-view hero-lines absolute inset-0 z-0 overflow-visible">
        <SonicBoom />
      </div>
      <div className="hero-animate in-view hero-logo relative z-10">
        <Image
          src="/LogoIconWhite.svg"
          alt="Alphix Logo"
          width={80}
          height={80}
          className="dark:block h-12 w-12 md:h-20 md:w-20"
          priority
          unoptimized
        />
      </div>
      <h1
        className="hero-animate in-view hero-title relative z-10 text-3xl leading-tight tracking-tight text-balance md:px-0 md:text-4xl"
      >
        {title}
      </h1>
      <p
        className="hero-animate in-view hero-desc relative z-10 max-w-xl text-center text-base leading-relaxed text-balance text-muted-foreground md:text-lg"
      >
        {description}
      </p>
      <div
        className="hero-animate in-view hero-cta relative z-10 mt-6 flex flex-row items-center gap-4 md:gap-6"
      >
        {children}
      </div>
    </div>
  )
}
