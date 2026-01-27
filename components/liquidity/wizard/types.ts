// Add Liquidity Wizard Types
// Restructured to match Uniswap's 2-step flow + review modal pattern

/**
 * Wizard Steps - Uniswap-aligned:
 * - Step 1: Select pool + LP mode (combined)
 * - Step 2: Set range + enter amounts (shown together)
 * - Modal: Review + Execute (triggered from Step 2)
 */
export enum WizardStep {
  POOL_AND_MODE = 0,
  RANGE_AND_AMOUNTS = 1,
}

export type LPMode = 'rehypo' | 'concentrated';

export interface WizardState {
  // Step tracking
  currentStep: WizardStep;

  // Pool selection (Step 1)
  token0Symbol: string | null;
  token1Symbol: string | null;
  poolId: string | null;

  // LP mode (Step 1)
  mode: LPMode;

  // Range - concentrated mode only (Step 2)
  tickLower: number | null;
  tickUpper: number | null;
  isFullRange: boolean;
  rangePreset: RangePreset | null;

  // Amounts (Step 2)
  amount0: string;
  amount1: string;
  inputSide: 'token0' | 'token1';

  // Review modal state
  isReviewModalOpen: boolean;

  // Derived data placeholders
  estimatedApr: number | null;
}

// Price strategies - pool-type dependent
// Stable pools: tick-based (narrow range around peg)
// Standard pools: percentage-based (wider ranges for volatile pairs)
export type RangePreset =
  // Stable pool presets (tick-based)
  | 'stable_narrow'     // 1 tick - Single tick at current price
  | 'stable_standard'   // Rehypo range - Optimized for lending yield
  | 'stable_wide'       // ± 2 ticks - Balanced range for stable pairs
  | 'stable_skewed'     // +1 / -3 ticks - Asymmetric for depeg protection
  | 'stable_moderate'   // Legacy: ± 3 ticks
  // Standard/Volatile pool presets (percentage-based)
  | 'narrow'            // ± 5% - Tight range
  | 'wide'              // ± 25% - Wide range for volatile pairs
  | 'skewed'            // +10 / -30% - Asymmetric for directional exposure
  | 'full'              // Full Range - Optimized for lending yield
  | 'moderate'          // Legacy: ± 5%
  // Legacy/custom
  | 'stable'            // Legacy: ± 3 ticks (maps to stable_moderate)
  | 'one_sided_lower'   // Legacy: –50%
  | 'one_sided_upper'   // Legacy: +100%
  | 'custom';           // User-defined

export interface WizardNavigationConfig {
  canGoBack: boolean;
  canGoForward: boolean;
  nextLabel: string;
  backLabel: string;
  showProgress: boolean;
}

export interface PoolOption {
  poolId: string;
  token0Symbol: string;
  token1Symbol: string;
  feeTier: number;
  tickSpacing: number;
  isStable: boolean;
}

// URL State sync interface
export interface WizardUrlState {
  step?: string;
  pool?: string;
  mode?: LPMode;
  t0?: string;  // token0 symbol
  t1?: string;  // token1 symbol
  tl?: string;  // tickLower
  tu?: string;  // tickUpper
  a0?: string;  // amount0
  a1?: string;  // amount1
}

// Step configuration - 2 steps only
export interface StepConfig {
  id: WizardStep;
  title: string;
  description: string;
}

export const WIZARD_STEPS: StepConfig[] = [
  {
    id: WizardStep.POOL_AND_MODE,
    title: 'Select Pool and Strategy',
    description: 'Choose token pair and LP strategy',
  },
  {
    id: WizardStep.RANGE_AND_AMOUNTS,
    title: 'Set Range and Deposit',
    description: 'Configure range and enter amounts',
  },
];

// Default state values
export const DEFAULT_WIZARD_STATE: WizardState = {
  currentStep: WizardStep.POOL_AND_MODE,
  token0Symbol: null,
  token1Symbol: null,
  poolId: null,
  mode: 'rehypo',
  tickLower: null,
  tickUpper: null,
  isFullRange: true,
  rangePreset: 'full',
  amount0: '',
  amount1: '',
  inputSide: 'token0',
  isReviewModalOpen: false,
  estimatedApr: null,
};

// Transaction step status for modal
export type TransactionStatus = 'idle' | 'pending' | 'in_progress' | 'completed' | 'error';

export interface TransactionStep {
  id: string;
  label: string;
  description: string;
  status: TransactionStatus;
  txHash?: string;
  errorMessage?: string;
}
