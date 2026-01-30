'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAccount, useSignMessage } from 'wagmi'
import { TOS_SIGNATURE_MESSAGE } from '@/lib/tos-content'

const TOS_STORAGE_PREFIX = 'alphix:tos:accepted:'

function getStorageKey(address: string): string {
  return `${TOS_STORAGE_PREFIX}${address.toLowerCase()}`
}

function hasAcceptedToS(address: string | undefined): boolean {
  if (!address || typeof window === 'undefined') return false
  try {
    return localStorage.getItem(getStorageKey(address)) === 'true'
  } catch {
    return false
  }
}

function persistAcceptance(address: string): void {
  try {
    localStorage.setItem(getStorageKey(address), 'true')
  } catch {
    // localStorage may be unavailable
  }
}

export interface UseToSAcceptanceReturn {
  showModal: boolean
  onConfirm: () => Promise<void>
  isSigningMessage: boolean
}

export function useToSAcceptance(): UseToSAcceptanceReturn {
  const { address, isConnected } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const [showModal, setShowModal] = useState(false)
  const [isSigningMessage, setIsSigningMessage] = useState(false)

  // Check acceptance status whenever wallet connection changes
  useEffect(() => {
    if (isConnected && address) {
      setShowModal(!hasAcceptedToS(address))
    } else {
      setShowModal(false)
    }
  }, [isConnected, address])

  const onConfirm = useCallback(async () => {
    if (!address) return

    setIsSigningMessage(true)
    try {
      await signMessageAsync({ message: TOS_SIGNATURE_MESSAGE })
      persistAcceptance(address)
      setShowModal(false)
    } catch {
      // User rejected signature or error occurred - modal stays open
    } finally {
      setIsSigningMessage(false)
    }
  }, [address, signMessageAsync])

  return { showModal, onConfirm, isSigningMessage }
}
