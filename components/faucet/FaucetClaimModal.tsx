'use client';

/**
 * FaucetClaimModal - Modal for claiming testnet tokens
 *
 * Uses the transaction wizard pattern to mint atDAI and atUSDC tokens.
 * Each token mint is a separate step tracked by the ProgressIndicator.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import Image from 'next/image';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { AlertCircle } from 'lucide-react';
import { IconXmark, IconCoins } from 'nucleo-micro-bold-essential';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ProgressIndicator } from '@/components/transactions';
import {
  TransactionStepType,
  createFaucetMintStep,
  type FaucetMintStep,
  type TransactionStep,
  type CurrentStepState,
} from '@/lib/transactions/types';
import { testnetTokenABI, TESTNET_TOKENS, BASE_SEPOLIA_CHAIN_ID } from '@/lib/faucet';
import { baseSepolia } from '@/lib/wagmiConfig';

interface FaucetClaimModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

type FaucetStep = 'atDAI' | 'atUSDC';
type FaucetStatus = 'idle' | 'executing' | 'success' | 'error';

export function FaucetClaimModal({ isOpen, onClose, onSuccess }: FaucetClaimModalProps) {
  const { address, chainId, isConnected } = useAccount();

  // Transaction state
  const [status, setStatus] = useState<FaucetStatus>('idle');
  const [currentStep, setCurrentStep] = useState<FaucetStep>('atDAI');
  const [completedSteps, setCompletedSteps] = useState<Set<FaucetStep>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // wagmi hooks for transactions
  const {
    writeContract,
    data: txHash,
    isPending: isWritePending,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: receiptError,
  } = useWaitForTransactionReceipt({ hash: txHash });

  // Build steps for the UI
  const steps: TransactionStep[] = useMemo(() => [
    createFaucetMintStep(
      TESTNET_TOKENS.atDAI.symbol,
      TESTNET_TOKENS.atDAI.address,
      '1000',
      TESTNET_TOKENS.atDAI.icon
    ),
    createFaucetMintStep(
      TESTNET_TOKENS.atUSDC.symbol,
      TESTNET_TOKENS.atUSDC.address,
      '1000',
      TESTNET_TOKENS.atUSDC.icon
    ),
  ], []);

  // Current step state for ProgressIndicator
  const currentStepState: CurrentStepState | undefined = useMemo(() => {
    if (status !== 'executing') return undefined;

    const stepIndex = currentStep === 'atDAI' ? 0 : 1;
    return {
      step: steps[stepIndex],
      accepted: isWritePending || isConfirming,
    };
  }, [status, currentStep, steps, isWritePending, isConfirming]);

  // Execute mint transaction
  const executeMint = useCallback((tokenKey: FaucetStep) => {
    if (!address) return;

    const token = TESTNET_TOKENS[tokenKey];
    writeContract({
      address: token.address,
      abi: testnetTokenABI,
      functionName: 'mint',
      args: [address, BigInt(token.mintAmount)],
      chainId: BASE_SEPOLIA_CHAIN_ID,
    });
  }, [address, writeContract]);

  // Handle transaction confirmation
  useEffect(() => {
    if (isConfirmed && status === 'executing') {
      // Mark current step as completed
      setCompletedSteps(prev => new Set(prev).add(currentStep));

      if (currentStep === 'atDAI') {
        // Move to next step (atUSDC)
        setCurrentStep('atUSDC');
        resetWrite();
        // Small delay before starting next transaction
        setTimeout(() => {
          executeMint('atUSDC');
        }, 500);
      } else {
        // Both steps completed
        setStatus('success');
        toast.success('Faucet Claimed', {
          description: 'You received 1000 atDAI and 1000 atUSDC',
        });

        // Trigger balance refresh
        setTimeout(() => {
          try {
            if (address) {
              localStorage.setItem(`walletBalancesRefreshAt_${address}`, String(Date.now()));
            }
            window.dispatchEvent(new Event('walletBalancesRefresh'));
          } catch {}
        }, 2000);

        onSuccess?.();

        // Auto close after success
        setTimeout(() => {
          handleClose();
        }, 1500);
      }
    }
  }, [isConfirmed, status, currentStep, address, resetWrite, executeMint, onSuccess]);

  // Handle errors
  useEffect(() => {
    const txError = writeError || receiptError;
    if (txError && status === 'executing') {
      const errorMessage = (txError as any)?.shortMessage || txError.message || 'Transaction failed';
      const isUserRejection = errorMessage.toLowerCase().includes('user rejected') ||
                              errorMessage.toLowerCase().includes('user denied');

      if (isUserRejection) {
        setStatus('idle');
        setError(null);
      } else {
        setStatus('error');
        setError(errorMessage);
      }
      resetWrite();
    }
  }, [writeError, receiptError, status, resetWrite]);

  // Start the faucet claim process
  const handleClaim = useCallback(() => {
    if (!isConnected) {
      toast.error('Wallet Not Connected', {
        description: 'Please connect your wallet first.',
      });
      return;
    }

    if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
      toast.error('Wrong Network', {
        description: `Please switch to ${baseSepolia.name}.`,
      });
      return;
    }

    if (!address) {
      toast.error('Address Error', {
        description: 'Could not retrieve wallet address.',
      });
      return;
    }

    // Reset state and start
    setStatus('executing');
    setCurrentStep('atDAI');
    setCompletedSteps(new Set());
    setError(null);
    resetWrite();

    // Start first mint
    executeMint('atDAI');
  }, [isConnected, chainId, address, resetWrite, executeMint]);

  // Handle retry
  const handleRetry = useCallback(() => {
    setError(null);
    setStatus('idle');
    resetWrite();
  }, [resetWrite]);

  // Handle close
  const handleClose = useCallback(() => {
    if (status === 'executing' && (isWritePending || isConfirming)) {
      // Don't close while transaction is pending
      return;
    }
    setStatus('idle');
    setCurrentStep('atDAI');
    setCompletedSteps(new Set());
    setError(null);
    resetWrite();
    onClose();
  }, [status, isWritePending, isConfirming, resetWrite, onClose]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStatus('idle');
      setCurrentStep('atDAI');
      setCompletedSteps(new Set());
      setError(null);
      resetWrite();
    }
  }, [isOpen, resetWrite]);

  const isExecuting = status === 'executing' && (isWritePending || isConfirming);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-[380px] bg-container border-sidebar-border p-0 gap-0 [&>button]:hidden">
        <div className="flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <span className="text-base font-medium text-muted-foreground">
              {status === 'executing' ? 'Claiming Tokens' : status === 'success' ? 'Tokens Claimed' : 'Testnet Faucet'}
            </span>
            <button
              onClick={handleClose}
              disabled={isExecuting}
              className="text-muted-foreground hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <IconXmark className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="px-4 py-4">
            {/* Icon and Description */}
            <div className="flex flex-col items-center text-center mb-6">
              <div className="w-16 h-16 rounded-2xl bg-sidebar-accent flex items-center justify-center mb-4">
                <IconCoins className="w-8 h-8 text-button-primary" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-1">Claim Testnet Tokens</h3>
              <p className="text-sm text-muted-foreground">
                Receive 1000 atDAI and 1000 atUSDC for testing
              </p>
            </div>

            {/* Token Preview */}
            <div className="flex flex-col gap-3 mb-6">
              {[
                { token: TESTNET_TOKENS.atDAI, completed: completedSteps.has('atDAI') },
                { token: TESTNET_TOKENS.atUSDC, completed: completedSteps.has('atUSDC') },
              ].map(({ token, completed }) => (
                <div
                  key={token.symbol}
                  className={`flex items-center justify-between p-3 rounded-lg bg-sidebar-accent/50 transition-opacity ${completed ? 'opacity-50' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <Image
                      src={token.icon}
                      alt={token.symbol}
                      width={32}
                      height={32}
                      className="rounded-full"
                    />
                    <div>
                      <span className="text-sm font-medium text-white">{token.symbol}</span>
                      <p className="text-xs text-muted-foreground">Testnet Token</p>
                    </div>
                  </div>
                  <span className="text-sm font-medium text-white">
                    {completed ? '1000' : '+1000'}
                  </span>
                </div>
              ))}
            </div>

            {/* Error Display */}
            {error && (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 mb-4">
                <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-red-400">{error}</p>
                  <button
                    onClick={handleRetry}
                    className="text-xs text-red-400 hover:text-red-300 underline mt-1"
                  >
                    Try again
                  </button>
                </div>
              </div>
            )}

            {/* Progress Indicator (during execution) */}
            {status === 'executing' && currentStepState && (
              <div className="mb-4">
                <ProgressIndicator steps={steps} currentStep={currentStepState} />
              </div>
            )}

            {/* Success Message */}
            {status === 'success' && (
              <div className="flex items-center justify-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20 mb-4">
                <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-green-400">Tokens successfully minted!</span>
              </div>
            )}

            {/* Action Button */}
            {status === 'idle' && (
              <Button
                onClick={handleClaim}
                className="w-full h-12 text-base font-semibold bg-button-primary border border-sidebar-primary text-sidebar-primary hover:bg-button-primary/90"
              >
                Claim Tokens
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
