/**
 * Step Status Enum
 * Copied from: interface/packages/uniswap/src/components/ConfirmSwapModal/types.ts
 *
 * Drives visual state of transaction step row components
 */
export enum StepStatus {
  Preview = 0,    // Future step, grayed out
  Active = 1,     // Current step, awaiting user action in wallet
  InProgress = 2, // User action submitted, waiting for confirmation
  Complete = 3,   // Step finished successfully
}
