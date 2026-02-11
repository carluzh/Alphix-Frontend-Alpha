/**
 * Zap Step Handlers
 *
 * Handlers for executing zap-specific transaction steps.
 * These integrate with the existing step executor registry.
 */

import type { Hex, Address } from 'viem';
import type {
  ZapSwapApprovalStep,
  ZapPSMSwapStep,
  ZapPoolSwapStep,
  ZapTransactionStepType,
} from '../../types';
import type {
  TransactionFunctions,
  StepExecutionContext,
  TransactionStepHandler,
} from '../../../transaction/executor/handlers/registry';
import { getStoredUserSettings } from '@/hooks/useUserSettings';
import { USDS_USDC_POOL_CONFIG } from '../../constants';

// Helper to get token decimals from config
const getTokenDecimals = (token: 'USDS' | 'USDC'): number =>
  token === 'USDS' ? USDS_USDC_POOL_CONFIG.token0.decimals : USDS_USDC_POOL_CONFIG.token1.decimals;

// =============================================================================
// SWAP APPROVAL HANDLER
// =============================================================================

/**
 * Handle ZapSwapApproval step.
 *
 * Approves input token for swap (to PSM or Permit2).
 */
export const handleZapSwapApprovalStep: TransactionStepHandler = async (
  step,
  context,
  txFunctions
): Promise<`0x${string}`> => {
  const typedStep = step as unknown as ZapSwapApprovalStep;

  console.log(`[ZapSwapApproval] Approving ${typedStep.tokenSymbol} to ${typedStep.spender}`);

  // Signal step is starting (waiting for user)
  context.setCurrentStep({ step, accepted: false });

  // Send approval transaction
  const hash = await txFunctions.sendTransaction({
    to: typedStep.txRequest.to as `0x${string}`,
    data: typedStep.txRequest.data as Hex,
    value: typedStep.txRequest.value,
  });

  console.log(`[ZapSwapApproval] Transaction submitted: ${hash}`);

  // Signal transaction was accepted
  context.setCurrentStep({ step, accepted: true });

  // Wait for confirmation
  const receipt = await txFunctions.waitForReceipt({ hash });

  if (receipt.status !== 'success') {
    throw new Error(`Swap approval failed: ${hash}`);
  }

  console.log(`[ZapSwapApproval] Confirmed: ${hash}`);

  return hash;
};

// =============================================================================
// PSM SWAP HANDLER
// =============================================================================

/**
 * Handle ZapPSMSwap step.
 *
 * Executes a 1:1 swap via the PSM contract.
 */
export const handleZapPSMSwapStep: TransactionStepHandler = async (
  step,
  context,
  txFunctions
): Promise<`0x${string}`> => {
  const typedStep = step as unknown as ZapPSMSwapStep;

  console.log(
    `[ZapPSMSwap] Swapping ${typedStep.direction}: ${typedStep.inputAmount} -> ${typedStep.expectedOutputAmount}`
  );

  // Signal step is starting
  context.setCurrentStep({ step, accepted: false });

  // Send PSM swap transaction
  const hash = await txFunctions.sendTransaction({
    to: typedStep.txRequest.to as `0x${string}`,
    data: typedStep.txRequest.data as Hex,
    value: typedStep.txRequest.value,
  });

  console.log(`[ZapPSMSwap] Transaction submitted: ${hash}`);

  // Signal transaction was accepted
  context.setCurrentStep({ step, accepted: true });

  // Wait for confirmation
  const receipt = await txFunctions.waitForReceipt({ hash });

  if (receipt.status !== 'success') {
    throw new Error(`PSM swap failed: ${hash}`);
  }

  console.log(`[ZapPSMSwap] Confirmed: ${hash}`);

  return hash;
};

// =============================================================================
// POOL SWAP HANDLER
// =============================================================================

/**
 * Handle ZapPoolSwap step.
 *
 * Executes a swap via the Universal Router by calling the existing
 * /api/swap/prepare-permit and /api/swap/build-tx endpoints.
 * This follows the same flow as useSwapExecution.ts.
 */
export const handleZapPoolSwapStep: TransactionStepHandler = async (
  step,
  context,
  txFunctions
): Promise<`0x${string}`> => {
  const typedStep = step as unknown as ZapPoolSwapStep;

  console.log(
    `[ZapPoolSwap] Swapping ${typedStep.inputToken} -> ${typedStep.outputToken}: ${typedStep.inputAmount}`
  );

  const inputDecimals = getTokenDecimals(typedStep.inputToken);
  const outputDecimals = getTokenDecimals(typedStep.outputToken);
  const chainId = context.chainId || 8453; // Default to Base mainnet

  // Get user's approval mode setting (exact or infinite)
  const userSettings = getStoredUserSettings();

  // Step 1: Call prepare-permit to check if we need a Permit2 signature
  console.log('[ZapPoolSwap] Calling prepare-permit API...');
  const preparePermitResponse = await fetch('/api/swap/prepare-permit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userAddress: context.address,
      fromTokenSymbol: typedStep.inputToken,
      fromTokenAddress: typedStep.inputTokenAddress,
      toTokenSymbol: typedStep.outputToken,
      chainId,
      amountIn: typedStep.inputAmount.toString(),
      approvalMode: userSettings.approvalMode, // Use user's setting (exact or infinite)
    }),
  });

  if (!preparePermitResponse.ok) {
    const errorData = await preparePermitResponse.json().catch(() => ({}));
    throw new Error(`Failed to prepare permit: ${errorData.message || preparePermitResponse.statusText}`);
  }

  const permitResult = await preparePermitResponse.json();
  if (!permitResult.ok) {
    throw new Error(`Prepare permit failed: ${permitResult.message}`);
  }

  console.log('[ZapPoolSwap] Permit result:', {
    needsPermit: permitResult.needsPermit,
    isApproved: permitResult.isApproved,
  });

  // Step 2: If permit needed, sign it
  let permitSignature = '0x';
  let permitData = {
    permitTokenAddress: typedStep.inputTokenAddress,
    permitAmount: '0',
    permitNonce: 0,
    permitExpiration: 0,
    permitSigDeadline: '0',
  };

  if (permitResult.needsPermit) {
    if (!context.signTypedData) {
      throw new Error('signTypedData not available in context - cannot sign Permit2 permit');
    }

    console.log('[ZapPoolSwap] Signing Permit2 permit...');

    // Convert message amounts back to bigint for signing
    const typedMessage = {
      details: {
        token: permitResult.permitData.message.details.token as Address,
        amount: BigInt(permitResult.permitData.message.details.amount),
        expiration: permitResult.permitData.message.details.expiration,
        nonce: permitResult.permitData.message.details.nonce,
      },
      spender: permitResult.permitData.message.spender as Address,
      sigDeadline: BigInt(permitResult.permitData.message.sigDeadline),
    };

    permitSignature = await context.signTypedData({
      domain: permitResult.permitData.domain,
      types: permitResult.permitData.types,
      primaryType: permitResult.permitData.primaryType,
      message: typedMessage,
    });

    console.log('[ZapPoolSwap] Permit signed');

    // Store permit data for build-tx call
    permitData = {
      permitTokenAddress: permitResult.permitData.message.details.token,
      permitAmount: permitResult.permitData.message.details.amount,
      permitNonce: permitResult.permitData.message.details.nonce,
      permitExpiration: permitResult.permitData.message.details.expiration,
      permitSigDeadline: permitResult.permitData.message.sigDeadline,
    };
  }

  // Step 3: Build swap transaction using existing API
  console.log('[ZapPoolSwap] Calling build-tx API...');
  const buildTxResponse = await fetch('/api/swap/build-tx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userAddress: context.address,
      fromTokenSymbol: typedStep.inputToken,
      toTokenSymbol: typedStep.outputToken,
      swapType: 'ExactIn',
      amountDecimalsStr: (Number(typedStep.inputAmount) / 10 ** inputDecimals).toString(),
      limitAmountDecimalsStr: (Number(typedStep.minOutputAmount) / 10 ** outputDecimals).toString(),
      permitSignature,
      permitTokenAddress: permitData.permitTokenAddress,
      permitAmount: permitData.permitAmount,
      permitNonce: permitData.permitNonce,
      permitExpiration: permitData.permitExpiration,
      permitSigDeadline: permitData.permitSigDeadline,
      chainId,
    }),
  });

  if (!buildTxResponse.ok) {
    const errorData = await buildTxResponse.json().catch(() => ({}));
    throw new Error(`Failed to build pool swap tx: ${errorData.message || buildTxResponse.statusText}`);
  }

  const txData = await buildTxResponse.json();
  if (!txData.ok) {
    throw new Error(`Pool swap build failed: ${txData.message}`);
  }

  console.log(`[ZapPoolSwap] Built transaction to ${txData.to}`);

  // Signal step is starting (user will confirm tx)
  context.setCurrentStep({ step, accepted: false });

  // Step 4: Encode and send the execute call for Universal Router
  const { encodeFunctionData } = await import('viem');
  const executeCalldata = encodeFunctionData({
    abi: [
      {
        name: 'execute',
        type: 'function',
        stateMutability: 'payable',
        inputs: [
          { name: 'commands', type: 'bytes' },
          { name: 'inputs', type: 'bytes[]' },
          { name: 'deadline', type: 'uint256' },
        ],
        outputs: [],
      },
    ],
    functionName: 'execute',
    args: [txData.commands, txData.inputs, BigInt(txData.deadline)],
  });

  // Send swap transaction via Universal Router
  const hash = await txFunctions.sendTransaction({
    to: txData.to as `0x${string}`,
    data: executeCalldata,
    value: BigInt(txData.value || '0'),
  });

  console.log(`[ZapPoolSwap] Transaction submitted: ${hash}`);

  // Signal transaction was accepted
  context.setCurrentStep({ step, accepted: true });

  // Wait for confirmation
  const receipt = await txFunctions.waitForReceipt({ hash });

  if (receipt.status !== 'success') {
    throw new Error(`Pool swap failed: ${hash}`);
  }

  console.log(`[ZapPoolSwap] Confirmed: ${hash}`);

  return hash;
};

// =============================================================================
// REGISTRY ENTRIES
// =============================================================================

/**
 * Zap step handler entries for the registry.
 *
 * Import and spread these into STEP_HANDLER_REGISTRY to enable
 * zap step execution.
 */
export const ZAP_STEP_HANDLERS = {
  ZapSwapApproval: {
    handler: handleZapSwapApprovalStep,
  },
  ZapPSMSwap: {
    handler: handleZapPSMSwapStep,
  },
  ZapPoolSwap: {
    handler: handleZapPoolSwapStep,
  },
} as const;

// =============================================================================
// TYPE GUARD
// =============================================================================

/**
 * Check if a step type is a zap step.
 */
export function isZapStep(stepType: string): boolean {
  return (
    stepType === 'ZapSwapApproval' ||
    stepType === 'ZapPSMSwap' ||
    stepType === 'ZapPoolSwap'
  );
}
