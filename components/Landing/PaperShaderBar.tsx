'use client'

import { GrainGradient } from '@paper-design/shaders-react'
import { motion } from 'framer-motion'
import { useMemo } from 'react'

export const PaperShaderBar = () => {
  const shaderFrame = useMemo(() => {
    if (typeof window === 'undefined' || typeof performance === 'undefined') return 0
    const w = window as unknown as { __shaderStartMs?: number }
    if (w.__shaderStartMs == null) {
      w.__shaderStartMs = performance.now()
    }
    return performance.now() - w.__shaderStartMs
  }, [])

  return (
    <motion.div
      className="w-[calc(100%+8rem)] -mx-16 h-2.5 rounded-lg overflow-hidden"
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
    >
      <GrainGradient
        style={{ height: '100%', width: '100%' }}
        colors={['#f94706', '#ff7919']}
        colorBack="#060606"
        softness={0.30}
        intensity={0.25}
        noise={0}
        shape="wave"
        speed={0.26}
        scale={1.04}
        rotation={32}
        frame={shaderFrame}
      />
    </motion.div>
  )
}
