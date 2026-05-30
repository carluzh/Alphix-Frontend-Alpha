"use client";

/**
 * useUnifiedYieldDepositPreview
 *
 * Encapsulates the wizard's Unified Yield deposit-preview effect that previously
 * lived inline in CreatePositionTxContext. Owns `depositPreview` + `isCalculating`,
 * the input-wei dedupe guard, the four null-reset early-exits, the cancellation
 * flag, and Sentry reporting.
 *
 * Behavior preserved verbatim:
 * - The dedupe guard (skip re-preview when active input side + wei are unchanged)
 *   keeps `depositPreview` in the effect dep array — do NOT drop either.
 * - All four early-exits set depositPreview to null (drives isConfirmDisabled /
 *   txInfo downstream) — do NOT remove any branch.
 * - `isCalculating` is set true before previewDeposit and cleared in `finally`
 *   only when not cancelled.
 * - reportError keeps `component: 'CreatePositionTxContext'` so Sentry grouping
 *   is unchanged.
 */

import { useEffect, useState } from "react";
import { parseUnits, type Address } from "viem";
import { previewDeposit } from "@/lib/liquidity/unified-yield/buildUnifiedYieldDepositTx";
import type { DepositPreviewResult } from "@/lib/liquidity/unified-yield/types";
import type { NetworkMode } from "@/lib/network-mode";
import { reportError } from "@/lib/observability";

type PoolChainClient = Parameters<typeof previewDeposit>[6];

export interface UseUnifiedYieldDepositPreviewParams {
  isUnifiedYield: boolean;
  hookAddress?: Address;
  poolChainClient: PoolChainClient;
  inputSide: "token0" | "token1";
  amount0: string;
  amount1: string;
  token0Decimals?: number;
  token1Decimals?: number;
  /** For reportError context only. */
  networkMode: NetworkMode;
  /** For reportError context only. */
  chainId: number;
}

export function useUnifiedYieldDepositPreview(p: UseUnifiedYieldDepositPreviewParams): {
  depositPreview: DepositPreviewResult | null;
  isCalculating: boolean;
} {
  const {
    isUnifiedYield,
    hookAddress,
    poolChainClient,
    inputSide,
    amount0,
    amount1,
    token0Decimals,
    token1Decimals,
    networkMode,
    chainId,
  } = p;

  const [depositPreview, setDepositPreview] = useState<DepositPreviewResult | null>(null);
  const [isUnifiedYieldCalculating, setIsUnifiedYieldCalculating] = useState(false);

  useEffect(() => {
    if (!isUnifiedYield || !hookAddress || !poolChainClient) {
      setDepositPreview(null);
      return;
    }

    const activeInputSide = inputSide === "token0" ? "token0" : inputSide === "token1" ? "token1" : null;
    if (!activeInputSide) {
      setDepositPreview(null);
      return;
    }

    const inputAmount = activeInputSide === "token0" ? amount0 : amount1;
    const inputDecimals = activeInputSide === "token0"
      ? (token0Decimals ?? 18)
      : (token1Decimals ?? 18);

    if (!inputAmount || parseFloat(inputAmount) <= 0) {
      setDepositPreview(null);
      return;
    }

    const inputWei = parseUnits(inputAmount, inputDecimals);

    if (depositPreview && depositPreview.inputSide === activeInputSide) {
      const existingInputAmount = activeInputSide === "token0"
        ? depositPreview.amount0
        : depositPreview.amount1;
      if (existingInputAmount === inputWei) {
        return;
      }
    }

    let cancelled = false;
    setIsUnifiedYieldCalculating(true);

    previewDeposit(
      hookAddress,
      inputWei,
      activeInputSide,
      token0Decimals ?? 18,
      token1Decimals ?? 18,
      18,
      poolChainClient
    )
      .then((preview) => {
        if (!cancelled && preview) {
          setDepositPreview(preview);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn("Unified Yield preview failed:", err);
          setDepositPreview(null);
          reportError(err, {
            domain: "unified-yield",
            action: "preview",
            component: "CreatePositionTxContext",
            networkMode,
            chainId,
            tags: { inputSide: activeInputSide || "unknown" },
            extras: {
              hookAddress,
              inputAmount: inputWei.toString(),
              inputSide: activeInputSide,
              token0Decimals,
              token1Decimals,
              cause: err?.cause?.message || err?.cause,
              shortMessage: err?.shortMessage,
            },
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsUnifiedYieldCalculating(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // Dep array preserved verbatim from the original inline effect — networkMode/chainId
    // are intentionally NOT listed (reportError context only), matching prior behavior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isUnifiedYield,
    hookAddress,
    poolChainClient,
    inputSide,
    amount0,
    amount1,
    token0Decimals,
    token1Decimals,
    depositPreview,
  ]);

  return { depositPreview, isCalculating: isUnifiedYieldCalculating };
}
