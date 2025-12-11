'use client'

import { cn } from '@/lib/utils'
import { motion } from 'framer-motion'
import Image from 'next/image'
import { PropsWithChildren, ReactNode } from 'react'
import { SonicBoom } from './SonicBoom'

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
    },
  },
}

const logoVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: 'easeOut' as const }
  },
}

const linesVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.2, delay: 0.1 }
  },
}

const itemVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.3 } },
}

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
    <motion.div
      className={cn(
        'relative flex flex-col items-center justify-center gap-4 px-4 pt-8 text-center md:pt-12',
        className,
      )}
      variants={containerVariants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true }}
    >
      <motion.div variants={linesVariants} className="z-0">
        <SonicBoom />
      </motion.div>
      <motion.div variants={logoVariants} className="relative z-10">
        <Image
          src="/LogoIconWhite.svg"
          alt="Alphix Logo"
          width={80}
          height={80}
          className="dark:block"
          priority
        />
      </motion.div>
      <motion.h1
        className="relative z-10 text-2xl leading-tight tracking-tight text-balance md:px-0 md:text-4xl"
        variants={itemVariants}
      >
        {title}
      </motion.h1>
      <motion.p
        className="relative z-10 max-w-xl text-center text-lg leading-relaxed text-balance text-muted-foreground"
        variants={itemVariants}
      >
        {description}
      </motion.p>
      <motion.div
        className="relative z-10 mt-6 flex flex-col items-center gap-4 md:flex-row md:gap-6"
        variants={itemVariants}
      >
        {children}
      </motion.div>
    </motion.div>
  )
}
