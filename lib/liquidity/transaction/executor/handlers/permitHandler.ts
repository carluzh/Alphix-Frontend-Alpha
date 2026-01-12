/**
 * Permit Signature Handler
 *
 * COPIED FROM UNISWAP - DO NOT MODIFY WITHOUT UPDATING FROM SOURCE
 * Source: interface/apps/web/src/state/sagas/transactions/utils.ts
 *
 * Handles Permit2 signature steps for gasless approvals.
 * Adapted from Redux Saga to async/await with wagmi hooks.
 *
 * C3 Enhancement: Caches signed permits for retry resilience.
 */

import type { Permit2SignatureStep } from '../../../types';
import { cacheSignedPermit, type CachedPermit } from '@/lib/permit-types';

// =============================================================================
// TYPES - Matches Uniswap's HandleSignatureStepParams
// =============================================================================

export interface HandleSignatureStepParams {
  address: `0x${string}`;
  step: Permit2SignatureStep;
  setCurrentStep: (params: { step: Permit2SignatureStep; accepted: boolean }) => void;
  // C3: Optional caching params for permit recovery
  chainId?: number;
  token0Symbol?: string;
  token1Symbol?: string;
  tickLower?: number;
  tickUpper?: number;
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
  const { step, setCurrentStep, address, chainId, token0Symbol, token1Symbol, tickLower, tickUpper } = params;

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

  // C3: Cache signed permit for retry resilience
  if (chainId && token0Symbol && token1Symbol) {
    try {
      const cached: CachedPermit = {
        permitBatchData: {
          domain: step.domain,
          types: step.types,
          values: step.values as CachedPermit['permitBatchData']['values'],
        },
        signature,
        timestamp: Date.now(),
        userAddress: address,
        chainId,
        token0Symbol,
        token1Symbol,
        tickLower: tickLower ?? 0,
        tickUpper: tickUpper ?? 0,
      };
      cacheSignedPermit(cached);
    } catch (e) {
      console.warn('[permitHandler] Failed to cache permit signature:', e);
    }
  }

  // Mark step as accepted after successful signature - MATCHES UNISWAP
  setCurrentStep({ step, accepted: true });

  return signature;
}
