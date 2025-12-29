"use client";

/**
 * TransactionProgress - Step indicator for liquidity transaction flows
 *
 * Shows progress through approve → permit → execute flow.
 * Used in Review steps for both Increase and Decrease operations.
 */

import React from "react";
import { RefreshCw as RefreshCwIcon, Check, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

export type TransactionStepStatus = "pending" | "in_progress" | "completed" | "error";

export interface TransactionStep {
  /** Unique identifier for the step */
  id: string;
  /** Display label for the step */
  label: string;
  /** Current status of the step */
  status: TransactionStepStatus;
  /** Optional count display (e.g., "1/2" for approvals) */
  count?: { current: number; total: number };
  /** Optional error message */
  error?: string;
}

export interface TransactionProgressProps {
  /** Array of transaction steps */
  steps: TransactionStep[];
  /** Optional title above the steps */
  title?: string;
  /** Compact mode for smaller display */
  compact?: boolean;
}

/**
 * Status icon component
 */
function StepStatusIcon({ status }: { status: TransactionStepStatus }) {
  switch (status) {
    case "completed":
      return <Check className="h-4 w-4 text-green-500" />;
    case "in_progress":
      return <RefreshCwIcon className="h-4 w-4 animate-spin text-primary" />;
    case "error":
      return <Circle className="h-4 w-4 text-red-500 fill-red-500" />;
    case "pending":
    default:
      return <Circle className="h-4 w-4 text-muted-foreground" />;
  }
}

/**
 * Count display component
 */
function StepCount({ current, total, status }: { current: number; total: number; status: TransactionStepStatus }) {
  const isComplete = current === total && status === "completed";

  return (
    <span className={cn(
      "text-xs font-mono",
      isComplete ? "text-green-500" : "text-muted-foreground"
    )}>
      {current}/{total}
    </span>
  );
}

/**
 * Individual step row
 */
function TransactionStepRow({ step, compact }: { step: TransactionStep; compact?: boolean }) {
  return (
    <div className={cn(
      "flex items-center justify-between",
      compact ? "py-1" : "py-1.5"
    )}>
      <div className="flex items-center gap-2">
        <StepStatusIcon status={step.status} />
        <span className={cn(
          "text-muted-foreground",
          compact ? "text-xs" : "text-sm"
        )}>
          {step.label}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {step.status === "in_progress" && !step.count && (
          <span className="text-xs text-primary animate-pulse">Processing...</span>
        )}
        {step.count && (
          <StepCount
            current={step.count.current}
            total={step.count.total}
            status={step.status}
          />
        )}
        {step.error && (
          <span className="text-xs text-red-500 max-w-[120px] truncate">
            {step.error}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Transaction progress indicator showing all steps in a flow.
 */
export function TransactionProgress({
  steps,
  title = "Transaction Steps",
  compact = false,
}: TransactionProgressProps) {
  if (steps.length === 0) return null;

  return (
    <div className={cn(
      "rounded-md border border-dashed bg-muted/10",
      compact ? "p-2" : "p-3"
    )}>
      <p className={cn(
        "font-medium text-foreground/80",
        compact ? "text-xs mb-1.5" : "text-sm mb-2"
      )}>
        {title}
      </p>
      <div className="space-y-0.5">
        {steps.map((step) => (
          <TransactionStepRow key={step.id} step={step} compact={compact} />
        ))}
      </div>
    </div>
  );
}

/**
 * Helper to create standard increase liquidity steps
 */
export function createIncreaseLiquiditySteps({
  approvalStatus,
  approvalCount,
  permitSigned,
  permitStatus,
  depositStatus,
}: {
  approvalStatus: TransactionStepStatus;
  approvalCount: { completed: number; total: number };
  permitSigned: boolean;
  permitStatus: TransactionStepStatus;
  depositStatus: TransactionStepStatus;
}): TransactionStep[] {
  return [
    {
      id: "approvals",
      label: "Token Approvals",
      status: approvalStatus,
      count: { current: approvalCount.completed, total: approvalCount.total },
    },
    {
      id: "permit",
      label: "Permit Signature",
      status: permitStatus,
      count: { current: permitSigned ? 1 : 0, total: 1 },
    },
    {
      id: "deposit",
      label: "Deposit Transaction",
      status: depositStatus,
      count: { current: depositStatus === "completed" ? 1 : 0, total: 1 },
    },
  ];
}

/**
 * Helper to create standard decrease liquidity steps
 */
export function createDecreaseLiquiditySteps({
  withdrawStatus,
  collectFeesStatus,
  includeCollectFees = false,
}: {
  withdrawStatus: TransactionStepStatus;
  collectFeesStatus?: TransactionStepStatus;
  includeCollectFees?: boolean;
}): TransactionStep[] {
  const steps: TransactionStep[] = [
    {
      id: "withdraw",
      label: "Withdraw Liquidity",
      status: withdrawStatus,
      count: { current: withdrawStatus === "completed" ? 1 : 0, total: 1 },
    },
  ];

  if (includeCollectFees && collectFeesStatus) {
    steps.push({
      id: "collect-fees",
      label: "Collect Fees",
      status: collectFeesStatus,
      count: { current: collectFeesStatus === "completed" ? 1 : 0, total: 1 },
    });
  }

  return steps;
}

/**
 * Simplified progress bar variant
 */
export function TransactionProgressBar({
  currentStep,
  totalSteps,
  isProcessing,
}: {
  currentStep: number;
  totalSteps: number;
  isProcessing: boolean;
}) {
  const progress = (currentStep / totalSteps) * 100;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Step {currentStep} of {totalSteps}</span>
        {isProcessing && (
          <RefreshCwIcon className="h-3 w-3 animate-spin" />
        )}
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted/40 overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full bg-primary transition-all duration-300",
            isProcessing && "animate-pulse"
          )}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
