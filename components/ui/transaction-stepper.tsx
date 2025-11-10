"use client";

import React from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';

export type StepStatus = 'pending' | 'active' | 'loading' | 'completed' | 'error';

export interface TransactionSubStep {
  id: string;
  label: string;
  status: StepStatus;
}

export interface TransactionStep {
  id: string;
  label: string;
  status: StepStatus;
  subSteps?: TransactionSubStep[];
  errorMessage?: string;
  count?: { completed: number; total: number };
}

interface TransactionStepperProps {
  steps: TransactionStep[];
  className?: string;
  compact?: boolean;
}

export function TransactionStepper({ steps, className, compact = false }: TransactionStepperProps) {
  return (
    <div className={cn("space-y-1.5 text-xs text-muted-foreground", className)}>
      {steps.map((step) => (
        <StepItem key={step.id} step={step} compact={compact} />
      ))}
    </div>
  );
}

interface StepItemProps {
  step: TransactionStep;
  compact: boolean;
}

function StepItem({ step, compact }: StepItemProps) {
  return (
    <div className="flex items-center justify-between">
      <span>{step.label}</span>
      <span>
        {step.status === 'loading' ? (
          <Spinner className="h-4 w-4" />
        ) : step.count ? (
          // Has a count object, use it for display
          <span className={cn(
            "text-xs font-mono",
            // If 0/0, show green when status is completed, otherwise show the actual completion state
            (step.count.total === 0 && step.status === 'completed') ||
            (step.count.total > 0 && step.status === 'completed') ? 'text-green-500' : 'text-muted-foreground'
          )}>
            {`${step.count.completed}/${step.count.total}`}
          </span>
        ) : step.status === 'completed' ? (
          <span className="text-xs font-mono text-green-500">1/1</span>
        ) : (
          <span className="text-xs font-mono">0/1</span>
        )}
      </span>
    </div>
  );
}