'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAccount, useSignMessage } from 'wagmi'
import { TOS_SIGNATURE_MESSAGE, TOS_VERSION } from '@/lib/tos-content'

// ---------------------------------------------------------------------------
// localStorage helpers (fast cache — backend is source of truth)
// ---------------------------------------------------------------------------

const TOS_STORAGE_PREFIX = 'alphix:tos:accepted:'

interface StoredAcceptance {
  accepted: boolean
  tosVersion: string
}

function getStorageKey(address: string): string {
  return `${TOS_STORAGE_PREFIX}${address.toLowerCase()}`
}

function getCachedAcceptance(address: string | undefined): StoredAcceptance | null {
  if (!address || typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(getStorageKey(address))
    if (!raw) return null

    // Support legacy format ('true' string)
    if (raw === 'true') return null // force backend re-check to migrate

    const parsed: StoredAcceptance = JSON.parse(raw)
    if (parsed.accepted && parsed.tosVersion === TOS_VERSION) return parsed
    return null // version mismatch — re-check backend
  } catch {
    return null
  }
}

function persistAcceptance(address: string): void {
  try {
    const value: StoredAcceptance = { accepted: true, tosVersion: TOS_VERSION }
    localStorage.setItem(getStorageKey(address), JSON.stringify(value))
  } catch {
    // localStorage may be unavailable
  }
}

// ---------------------------------------------------------------------------
// Backend API helpers
// ---------------------------------------------------------------------------

async function checkBackendStatus(address: string): Promise<{ accepted: boolean; tosVersion?: string }> {
  const res = await fetch(`/api/tos/status?address=${encodeURIComponent(address)}`)
  if (!res.ok) throw new Error(`TOS status check failed: ${res.status}`)
  return res.json()
}

async function submitAcceptance(address: string, signature: string): Promise<void> {
  const backendUrl = process.env.NEXT_PUBLIC_ALPHIX_BACKEND_URL || 'http://localhost:3001'

  // 1. Try backend first (PostgreSQL audit trail)
  let backendSuccess = false
  try {
    const backendRes = await fetch(`${backendUrl}/tos/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userAddress: address,
        signature,
        message: TOS_SIGNATURE_MESSAGE,
        version: TOS_VERSION,
      }),
    })
    backendSuccess = backendRes.ok
    if (!backendSuccess) {
      console.warn('[useToSAcceptance] Backend TOS sign failed:', backendRes.status)
    }
  } catch (error) {
    console.warn('[useToSAcceptance] Backend TOS sign error:', error)
  }

  // 2. Always write to Redis (fast reads + fallback)
  const redisRes = await fetch('/api/tos/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address,
      signature,
      message: TOS_SIGNATURE_MESSAGE,
    }),
  })

  // Success if at least Redis write succeeds
  if (!redisRes.ok) {
    const body = await redisRes.json().catch(() => ({}))
    throw new Error(body.error || `TOS accept failed: ${redisRes.status}`)
  }

  if (backendSuccess) {
    console.log('[useToSAcceptance] TOS recorded in both backend and Redis')
  } else {
    console.log('[useToSAcceptance] TOS recorded in Redis only (backend unavailable)')
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseToSAcceptanceReturn {
  /** Whether the TOS modal should be displayed */
  showModal: boolean
  /** Callback to trigger wallet signing + backend submission */
  onConfirm: () => Promise<void>
  /** Wallet is prompting the user to sign */
  isSigningMessage: boolean
  /** Signature is being sent to the backend for verification */
  isSendingToBackend: boolean
  /** True once the check is complete (accepted OR modal shown OR wallet disconnected) */
  resolved: boolean
}

export function useToSAcceptance(): UseToSAcceptanceReturn {
  const { address, isConnected } = useAccount()
  const { signMessageAsync } = useSignMessage()

  const [showModal, setShowModal] = useState(false)
  const [isSigningMessage, setIsSigningMessage] = useState(false)
  const [isSendingToBackend, setIsSendingToBackend] = useState(false)
  const [resolved, setResolved] = useState(false)

  // Check acceptance status whenever wallet connection / address changes
  useEffect(() => {
    if (!isConnected || !address) {
      setShowModal(false)
      setResolved(true) // no wallet = nothing to check
      return
    }

    let cancelled = false

    async function check() {
      setResolved(false)
      setShowModal(false)

      // 1. Fast path: check localStorage cache
      const cached = getCachedAcceptance(address)
      if (cached) {
        setResolved(true)
        return
      }

      // 2. Slow path: check backend
      try {
        const { accepted, tosVersion } = await checkBackendStatus(address!)
        if (cancelled) return

        if (accepted && tosVersion === TOS_VERSION) {
          // Backend confirms acceptance — update localStorage cache
          persistAcceptance(address!)
          setResolved(true)
        } else {
          // Not accepted (or old version) — show modal
          setShowModal(true)
          setResolved(true)
        }
      } catch (error) {
        if (cancelled) return
        console.error('[useToSAcceptance] Backend check failed:', error)
        // On error, show modal to be safe — don't let users through without verification
        setShowModal(true)
        setResolved(true)
      }
    }

    check()

    return () => {
      cancelled = true
    }
  }, [isConnected, address])

  const onConfirm = useCallback(async () => {
    if (!address) return

    setIsSigningMessage(true)
    try {
      // 1. Get wallet signature
      const signature = await signMessageAsync({ message: TOS_SIGNATURE_MESSAGE })

      setIsSigningMessage(false)
      setIsSendingToBackend(true)

      // 2. Submit to backend for verification + storage
      await submitAcceptance(address, signature)

      // 3. Update localStorage cache
      persistAcceptance(address)

      // 4. Close modal
      setShowModal(false)
    } catch (error) {
      console.error('[useToSAcceptance] Acceptance failed:', error)
      // Modal stays open — user can retry
    } finally {
      setIsSigningMessage(false)
      setIsSendingToBackend(false)
    }
  }, [address, signMessageAsync])

  return { showModal, onConfirm, isSigningMessage, isSendingToBackend, resolved }
}
