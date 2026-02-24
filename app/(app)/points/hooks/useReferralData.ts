"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount, useSignMessage } from "wagmi";
import * as Sentry from "@sentry/nextjs";
import {
  fetchReferralCode,
  fetchRefereesData,
  fetchMyReferrer,
  DEFAULT_REFEREES_DATA,
  type CachedReferralCode,
  type CachedRefereesData,
  type CachedMyReferrer,
} from "@/lib/upstash-points";

// =============================================================================
// TYPES
// =============================================================================

export interface ReferralData {
  // My referral code
  myCode: string | null;
  myCodeUsageCount: number;
  // Who referred me
  myReferrer: string | null;
  myReferrerCode: string | null;
  joinedAt: number | null;
  // My referees
  referees: CachedRefereesData["referees"];
  totalReferees: number;
  totalEarnings: number;
  totalReferredTvlUsd: number;
  totalReferredVolumeUsd: number;
  // State
  isLoading: boolean;
  error: string | null;
}

export interface UseReferralDataReturn extends ReferralData {
  // Actions
  applyReferralCode: (code: string) => Promise<{ success: boolean; error?: string }>;
  changeReferrer: (newCode: string) => Promise<boolean>;
  getOrCreateReferralCode: () => Promise<string | null>;
  // URL tracking
  pendingReferralCode: string | null;
  clearPendingReferral: () => void;
}

// =============================================================================
// CONSTANTS
// =============================================================================

// Use same env var as backend-client.ts for consistency
const BACKEND_URL = process.env.NEXT_PUBLIC_ALPHIX_BACKEND_URL || "http://localhost:3001";
const PENDING_REFERRAL_KEY = "alphix_pending_referral";

// =============================================================================
// HOOK
// =============================================================================

export function useReferralData(): UseReferralDataReturn {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  // State
  const [myCode, setMyCode] = useState<string | null>(null);
  const [myCodeUsageCount, setMyCodeUsageCount] = useState(0);
  const [myReferrer, setMyReferrer] = useState<string | null>(null);
  const [myReferrerCode, setMyReferrerCode] = useState<string | null>(null);
  const [joinedAt, setJoinedAt] = useState<number | null>(null);
  const [refereesData, setRefereesData] = useState<CachedRefereesData>(DEFAULT_REFEREES_DATA);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingReferralCode, setPendingReferralCode] = useState<string | null>(null);

  // =============================================================================
  // URL REFERRAL TRACKING
  // =============================================================================

  // Check for pending referral in localStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const pending = localStorage.getItem(PENDING_REFERRAL_KEY);
      if (pending) {
        setPendingReferralCode(pending);
      }
    }
  }, []);

  // Check URL for referral code on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      const refCode = urlParams.get("ref");
      if (refCode) {
        localStorage.setItem(PENDING_REFERRAL_KEY, refCode);
        setPendingReferralCode(refCode);
        // Clean URL
        const newUrl = window.location.pathname;
        window.history.replaceState({}, "", newUrl);
      }
    }
  }, []);

  const clearPendingReferral = useCallback(() => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(PENDING_REFERRAL_KEY);
    }
    setPendingReferralCode(null);
  }, []);

  // =============================================================================
  // DATA FETCHING
  // =============================================================================

  // Fetch all referral data when connected
  useEffect(() => {
    // Reset state whenever address changes (including disconnect)
    setMyCode(null);
    setMyCodeUsageCount(0);
    setMyReferrer(null);
    setMyReferrerCode(null);
    setJoinedAt(null);
    setRefereesData(DEFAULT_REFEREES_DATA);

    if (!isConnected || !address) {
      return;
    }

    let cancelled = false;

    async function loadReferralData() {
      setIsLoading(true);
      setError(null);

      try {
        // Fetch all data in parallel from Upstash
        const [codeData, referrerData, refereesResult] = await Promise.all([
          fetchReferralCode(address!),
          fetchMyReferrer(address!),
          fetchRefereesData(address!),
        ]);

        if (cancelled) return;

        // Set my code - if not found in cache, auto-generate via backend
        if (codeData) {
          setMyCode(codeData.code);
          setMyCodeUsageCount(codeData.usageCount);
        } else {
          // Auto-generate referral code via backend (GET creates if doesn't exist)
          try {
            const response = await fetch(`${BACKEND_URL}/referral/code/${address}`, {
              method: "GET",
            });
            if (response.ok) {
              const data = await response.json();
              if (data.success && data.data) {
                // Check if user is eligible - backend returns success:true even when ineligible
                if (data.data.code === null && data.data.eligible === false) {
                  // User doesn't meet requirements (e.g., "Minimum $10 TVL or $50 volume required")
                  setMyCode("REQUIREMENTS_NOT_MET");
                } else if (data.data.code) {
                  setMyCode(data.data.code);
                  setMyCodeUsageCount(data.data.usageCount || 0);
                }
              }
            }
          } catch (codeErr) {
            // Silently fail code generation - not critical
            console.error("Failed to auto-generate referral code:", codeErr);
          }
        }

        // Set my referrer
        if (referrerData) {
          setMyReferrer(referrerData.referrer);
          setMyReferrerCode(referrerData.referralCode);
          setJoinedAt(referrerData.joinedAt);
        }

        // Set referees data
        if (refereesResult) {
          setRefereesData(refereesResult);
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "Failed to load referral data";
          setError(message);
          Sentry.captureException(err, {
            tags: { operation: "referral_fetch" },
            extra: { address },
          });
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadReferralData();

    return () => {
      cancelled = true;
    };
  }, [isConnected, address]);

  // =============================================================================
  // AUTO-APPLY PENDING REFERRAL ON CONNECT
  // =============================================================================

  useEffect(() => {
    // Only apply if:
    // 1. Connected
    // 2. Have pending code
    // 3. Don't already have a referrer
    // 4. Not loading
    if (
      isConnected &&
      address &&
      pendingReferralCode &&
      !myReferrer &&
      !isLoading
    ) {
      applyReferralCode(pendingReferralCode).then((result) => {
        if (result.success) {
          clearPendingReferral();
        }
      });
    }
  }, [isConnected, address, pendingReferralCode, myReferrer, isLoading]);

  // =============================================================================
  // ACTIONS
  // =============================================================================

  /**
   * Get or create referral code via backend
   */
  const getOrCreateReferralCode = useCallback(async (): Promise<string | null> => {
    if (!address || !isConnected) {
      setError("Wallet not connected");
      return null;
    }

    try {
      // First check Upstash
      const existing = await fetchReferralCode(address);
      if (existing) {
        setMyCode(existing.code);
        setMyCodeUsageCount(existing.usageCount);
        return existing.code;
      }

      // Create via backend
      const response = await fetch(`${BACKEND_URL}/referral/code/${address}`, {
        method: "GET",
      });

      if (!response.ok) {
        throw new Error("Failed to get referral code");
      }

      const data = await response.json();
      if (data.success && data.data) {
        setMyCode(data.data.code);
        setMyCodeUsageCount(data.data.usageCount);
        return data.data.code;
      }

      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to get referral code";
      setError(message);
      Sentry.captureException(err, {
        tags: { operation: "referral_get_code" },
        extra: { address },
      });
      return null;
    }
  }, [address, isConnected]);

  /**
   * Apply a referral code (requires signature)
   * Returns: { success: boolean, error?: string }
   */
  const applyReferralCode = useCallback(async (code: string): Promise<{ success: boolean; error?: string }> => {
    if (!address || !isConnected) {
      const errorMsg = "Wallet not connected";
      setError(errorMsg);
      return { success: false, error: errorMsg };
    }

    if (myReferrer) {
      const errorMsg = "You already have a referrer";
      setError(errorMsg);
      return { success: false, error: errorMsg };
    }

    try {
      // Sign message to prove ownership
      const message = `Apply referral code: ${code}\nAddress: ${address}\nTimestamp: ${Date.now()}`;

      let signature: string;
      try {
        signature = await signMessageAsync({ message });
      } catch (signErr: unknown) {
        // User rejected the signature request
        const err = signErr as { code?: number; message?: string };
        if (err?.code === 4001 || err?.message?.includes("rejected") || err?.message?.includes("denied")) {
          const errorMsg = "Signature rejected";
          setError(errorMsg);
          return { success: false, error: errorMsg };
        }
        throw signErr;
      }

      // Send to backend
      const response = await fetch(`${BACKEND_URL}/referral/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          refereeAddress: address,
          referralCode: code,
          signature,
          message,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        const backendError = errorData.error || "Failed to apply referral code";

        // Map exact backend error messages to user-friendly messages
        const errorMap: Record<string, string> = {
          "Cannot refer yourself": "You cannot refer yourself",
          "Invalid referral code": "Invalid referral code",
          "Already has a referrer": "You already have a referrer",
          "Circular referral not allowed": "Circular referral not allowed",
          "Invalid signature": "Signature verification failed",
          "Signature expired or invalid timestamp": "Signature expired, please try again",
          "Signature already used (replay detected)": "Please try again",
        };

        const userError = errorMap[backendError] || backendError;
        setError(userError);
        return { success: false, error: userError };
      }

      const data = await response.json();
      if (data.success && data.data) {
        setMyReferrer(data.data.referrerAddress);
        setMyReferrerCode(code);
        setJoinedAt(Date.now());
        clearPendingReferral();
        setError(null);
        return { success: true };
      }

      const errorMsg = "Failed to apply referral code";
      setError(errorMsg);
      return { success: false, error: errorMsg };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to apply referral code";
      setError(errorMsg);
      Sentry.captureException(err, {
        tags: { operation: "referral_apply" },
        extra: { address, code },
      });
      return { success: false, error: errorMsg };
    }
  }, [address, isConnected, myReferrer, signMessageAsync, clearPendingReferral]);

  /**
   * Change referrer (requires signature, only after lock period)
   */
  const changeReferrer = useCallback(async (newCode: string): Promise<boolean> => {
    if (!address || !isConnected) {
      setError("Wallet not connected");
      return false;
    }

    try {
      // Sign message to prove ownership
      const message = `Change referrer to code: ${newCode}\nAddress: ${address}\nTimestamp: ${Date.now()}`;
      const signature = await signMessageAsync({ message });

      // Send to backend
      const response = await fetch(`${BACKEND_URL}/referral/change`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userAddress: address,
          newReferralCode: newCode,
          signature,
          message,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to change referrer");
      }

      const data = await response.json();
      if (data.success && data.data) {
        setMyReferrer(data.data.newReferrer);
        setMyReferrerCode(newCode);
        return true;
      }

      return false;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to change referrer";
      setError(message);
      Sentry.captureException(err, {
        tags: { operation: "referral_change" },
        extra: { address, newCode },
      });
      return false;
    }
  }, [address, isConnected, signMessageAsync]);

  // =============================================================================
  // RETURN
  // =============================================================================

  return {
    // My referral code
    myCode,
    myCodeUsageCount,
    // Who referred me
    myReferrer,
    myReferrerCode,
    joinedAt,
    // My referees
    referees: refereesData.referees,
    totalReferees: refereesData.totalReferees,
    totalEarnings: refereesData.totalEarnings,
    totalReferredTvlUsd: refereesData.totalReferredTvlUsd,
    totalReferredVolumeUsd: refereesData.totalReferredVolumeUsd,
    // State
    isLoading,
    error,
    // Actions
    applyReferralCode,
    changeReferrer,
    getOrCreateReferralCode,
    // URL tracking
    pendingReferralCode,
    clearPendingReferral,
  };
}
