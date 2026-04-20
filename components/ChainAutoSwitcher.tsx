'use client'

import { useEffect, useRef } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import { SUPPORTED_CHAIN_IDS, chainIdForMode, parseNetworkMode } from '@/lib/network-mode'

export function ChainAutoSwitcher() {
  const { chainId: walletChainId, isConnected } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const lastAttemptedChainRef = useRef<number | null>(null)

  useEffect(() => {
    if (!isConnected || walletChainId == null) return
    if (SUPPORTED_CHAIN_IDS.includes(walletChainId)) return
    if (lastAttemptedChainRef.current === walletChainId) return

    lastAttemptedChainRef.current = walletChainId

    const chainParam = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('chain')
      : null
    const targetChainId = chainIdForMode(parseNetworkMode(chainParam))

    // If rejected, stay silent — ensureChain() re-prompts at transaction time.
    switchChainAsync({ chainId: targetChainId }).catch(() => {})
  }, [isConnected, walletChainId, switchChainAsync])

  return null
}
