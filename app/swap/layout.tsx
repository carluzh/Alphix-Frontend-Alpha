import type { Metadata } from 'next'
import React from 'react'

export const metadata: Metadata = {
  title: 'Swap',
}

export default function SwapLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      {children}
    </>
  )
} 