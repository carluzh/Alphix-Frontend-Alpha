/**
 * Permit Signature Handler
 *
 * COPIED FROM UNISWAP - DO NOT MODIFY WITHOUT UPDATING FROM SOURCE
 * Source: interface/apps/web/src/state/sagas/transactions/utils.ts
 *
 * Handles Permit2 signature steps for gasless approvals.
 * Adapted from Redux Saga to async/await with wagmi hooks.
 */

import type { Permit2SignatureStep } from '../../../types';

// =============================================================================
// TYPES - Matches Uniswap's HandleSignatureStepParams
// =============================================================================

export interface HandleSignatureStepParams {
  address: `0x${string}`;
  step: Permit2SignatureStep;
  setCurrentStep: (params: { step: Permit2SignatureStep; accepted: boolean }) => void;
}

// =============================================================================
// SIGNATURE HANDLER - COPIED FROM UNISWAP utils.ts lines 84-108
// =============================================================================

/**
 * Handles permit2 signature step
 *
 * ADAPTED FROM interface/apps/web/src/state/sagas/transactions/utils.ts
 * Original uses Redux Saga yield* call pattern, adapted to async/await
 *
 * @param params - Handler parameters including address, step, and callbacks
 * @param signTypedData - Wagmi signTypedDataAsync function
 * @returns Signature string on success
 */
export async function handleSignatureStep(
  params: HandleSignatureStepParams,
  signTypedData: (args: {
    domain: {
      name: string;
      chainId: number;
      verifyingContract: `0x${string}`;
    };
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  }) => Promise<`0x${string}`>,
): Promise<string> {
  const { step, setCurrentStep } = params;

  // Trigger UI prompting user to accept
  setCurrentStep({ step, accepted: false });

  // Get primary type from types object (usually 'PermitBatch' or 'PermitSingle')
  const primaryType = Object.keys(step.types).find(key => key !== 'EIP712Domain') || 'PermitBatch';

  // Sign typed data
  const signature = await signTypedData({
    domain: step.domain,
    types: step.types,
    primaryType,
    message: step.values,
  });

  // Mark step as accepted after successful signature - MATCHES UNISWAP
  setCurrentStep({ step, accepted: true });

  return signature;
}
