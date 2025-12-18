'use client'

import dynamic from 'next/dynamic'
import { useInViewClass } from '@/hooks/useInView'

export function LandingInViewInit() {
  useInViewClass({ once: true, threshold: 0.1 })
  return null
}

export const DynamicFeeSectionLazy = dynamic(
  () => import('./DynamicFeeSection').then((mod) => mod.DynamicFeeSection),
  { ssr: false }
)

export const PaperShaderFrameLazy = dynamic(
  () => import('./PaperShaderFrame').then((mod) => mod.PaperShaderFrame),
  { ssr: false }
)

