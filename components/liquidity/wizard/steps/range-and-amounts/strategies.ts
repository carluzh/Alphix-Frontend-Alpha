import { RangePreset } from '../../types';

// Price Strategy configurations - pool-type dependent
export interface PriceStrategyConfig {
  id: RangePreset;
  title: string;
  display: string;
  description: string;
}

// Stable pool strategies (tick-based for tight ranges around peg)
export const STABLE_POOL_STRATEGIES: PriceStrategyConfig[] = [
  {
    id: 'stable_narrow',
    title: 'Narrow',
    display: '1 tick',
    description: 'Single tick at current price',
  },
  {
    id: 'stable_standard',
    title: 'Standard',
    display: '± 1 tick',
    description: 'Optimized for lending yield',
  },
  {
    id: 'stable_wide',
    title: 'Wide',
    display: '± 2 ticks',
    description: 'Balanced range for stable pairs',
  },
  {
    id: 'stable_skewed',
    title: 'Skewed',
    display: '+1 / −3 ticks',
    description: 'Asymmetric for depeg protection',
  },
];

// Standard/Volatile pool strategies (percentage-based)
export const STANDARD_POOL_STRATEGIES: PriceStrategyConfig[] = [
  {
    id: 'narrow',
    title: 'Narrow',
    display: '± 5%',
    description: 'Tight range, higher fee concentration',
  },
  {
    id: 'wide',
    title: 'Wide',
    display: '± 25%',
    description: 'Wide range for volatile pairs',
  },
  {
    id: 'skewed',
    title: 'Skewed',
    display: '+10 / −30%',
    description: 'Asymmetric for directional exposure',
  },
  {
    id: 'full',
    title: 'Full Range',
    display: '0 → ∞',
    description: 'Optimized for lending yield',
  },
];

// Helper: Get default range preset based on pool type
export function getDefaultRangePreset(isStablePool: boolean): RangePreset {
  return isStablePool ? 'stable_narrow' : 'narrow';
}

// Helper: Get strategies for pool type
export function getStrategiesForPoolType(isStablePool: boolean): PriceStrategyConfig[] {
  return isStablePool ? STABLE_POOL_STRATEGIES : STANDARD_POOL_STRATEGIES;
}
