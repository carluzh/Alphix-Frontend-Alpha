"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount, useSignMessage } from "wagmi";
import * as Sentry from "@sentry/nextjs";
import {
  fetchReferralCode,
  fetchRefereesData,
  fetchMyReferrer,
  DEFAULT_REFEREES_DATA,
  type CachedRefereesData,
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

const BACKEND_URL = process.env.NEXT_PUBLIC_ALPHIX_BACKEND_URL || "http://localhost:3001";
const PENDING_REFERRAL_KEY = "alphix_pending_referral";

/**
 * Validate a referral code: alphanumeric, 4-32 chars.
 * Used to sanitize ?ref= values before storing or using them.
 */
const REFERRAL_CODE_REGEX = /^[a-zA-Z0-9]{4,32}$/;

function isValidReferralCode(code: string): boolean {
  return REFERRAL_CODE_REGEX.test(code);
}

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
  // URL REFERRAL TRACKING (with sanitization)
  // =============================================================================

  // Check for pending referral in localStorage on mount — re-validate before trusting
  useEffect(() => {
    if (typeof window !== "undefined") {
      const pending = localStorage.getItem(PENDING_REFERRAL_KEY);
      if (pending && isValidReferralCode(pending)) {
        setPendingReferralCode(pending);
      } else if (pending) {
        // Invalid value in localStorage — remove it
        localStorage.removeItem(PENDING_REFERRAL_KEY);
      }
    }
  }, []);

  // Check URL for referral code on mount — validate before storing
  useEffect(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      const refCode = urlParams.get("ref");
      if (refCode && isValidReferralCode(refCode)) {
        localStorage.setItem(PENDING_REFERRAL_KEY, refCode);
        setPendingReferralCode(refCode);
        // Clean URL
        const newUrl = window.location.pathname;
        window.history.replaceState({}, "", newUrl);
      } else if (refCode) {
        // Invalid ref code in URL — just clean the URL, don't store
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
        // Fetch all data in parallel from backend API
        const [codeData, referrerData, refereesResult] = await Promise.all([
          fetchReferralCode(address!),
          fetchMyReferrer(address!),
          fetchRefereesData(address!),
        ]);

        if (cancelled) return;

        // Set my code
        if (codeData) {
          if (codeData.code === null && codeData.eligible === false) {
            setMyCode("REQUIREMENTS_NOT_MET");
          } else if (codeData.code) {
            setMyCode(codeData.code);
            setMyCodeUsageCount(codeData.usageCount);
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
      const existing = await fetchReferralCode(address);
      if (existing && existing.code) {
        setMyCode(existing.code);
        setMyCodeUsageCount(existing.usageCount);
        return existing.code;
      }

      // If code is null but we got a response, user may not be eligible
      if (existing && existing.code === null && existing.eligible === false) {
        setMyCode("REQUIREMENTS_NOT_MET");
        return null;
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

    // Validate the code before using it in a signing message
    if (!isValidReferralCode(code)) {
      const errorMsg = "Invalid referral code format";
      setError(errorMsg);
      return { success: false, error: errorMsg };
    }

    try {
      const message = `Apply referral code: ${code}\nAddress: ${address}\nTimestamp: ${Date.now()}`;

      let signature: string;
      try {
        signature = await signMessageAsync({ message });
      } catch (signErr: unknown) {
        const err = signErr as { code?: number; message?: string };
        if (err?.code === 4001 || err?.message?.includes("rejected") || err?.message?.includes("denied")) {
          const errorMsg = "Signature rejected";
          setError(errorMsg);
          return { success: false, error: errorMsg };
        }
        throw signErr;
      }

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

      if (response.status === 429) {
        const errorMsg = "Too many requests. Please wait a moment and try again.";
        setError(errorMsg);
        return { success: false, error: errorMsg };
      }

      if (!response.ok) {
        const errorData = await response.json();
        const backendError = errorData.error || "Failed to apply referral code";

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

    // Validate the code before using it in a signing message
    if (!isValidReferralCode(newCode)) {
      setError("Invalid referral code format");
      return false;
    }

    try {
      const message = `Change referral code to: ${newCode}\nAddress: ${address}\nTimestamp: ${Date.now()}`;
      const signature = await signMessageAsync({ message });

      const response = await fetch(`${BACKEND_URL}/referral/change`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userAddress: address,
          newReferralCode: newCode,
          signature,
          message,
        }),
      });

      if (response.status === 429) {
        setError("Too many requests. Please wait a moment and try again.");
        return false;
      }

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
    myCode,
    myCodeUsageCount,
    myReferrer,
    myReferrerCode,
    joinedAt,
    referees: refereesData.referees,
    totalReferees: refereesData.totalReferees,
    totalEarnings: refereesData.totalEarnings,
    totalReferredTvlUsd: refereesData.totalReferredTvlUsd,
    totalReferredVolumeUsd: refereesData.totalReferredVolumeUsd,
    isLoading,
    error,
    applyReferralCode,
    changeReferrer,
    getOrCreateReferralCode,
    pendingReferralCode,
    clearPendingReferral,
  };
}
