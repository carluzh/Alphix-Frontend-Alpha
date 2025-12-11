'use client'

import { motion } from 'framer-motion'
import Image from 'next/image'
import { cn } from '@/lib/utils'

interface FeatureCardProps {
  title: string
  description: string
  image: string
  imageClassName?: string
}

interface FeatureCardsProps {
  features: FeatureCardProps[]
}

const containerVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5 }
  },
}

export const FeatureCards = ({ features }: FeatureCardsProps) => {
  return (
    <motion.div
      className="relative z-10 w-full rounded-lg border border-sidebar-border/60 bg-white dark:bg-[#131313] overflow-hidden"
      variants={containerVariants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true }}
    >
      <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-sidebar-border/60">
        {features.map((feature, index) => (
          <div
            key={index}
            className="group relative flex items-center p-5 overflow-hidden"
          >
            <div className="relative z-10 flex flex-col gap-1.5 w-3/5 pr-2">
              <h3 className="text-sm font-semibold text-foreground">
                {feature.title}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {feature.description}
              </p>
            </div>
            <div className="absolute right-0 top-0 bottom-0 w-2/3">
              <Image
                src={feature.image}
                alt={feature.title}
                fill
                sizes="(max-width: 768px) 66vw, 22vw"
                className={cn("object-cover transition-transform duration-300 ease-out group-hover:scale-110", feature.imageClassName)}
                // First card is likely LCP - prioritize it
                priority={index === 0}
              />
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  )
}
