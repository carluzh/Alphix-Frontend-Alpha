// Centralized number and currency formatting (US/UK style)
// Always use en-US locale to ensure comma thousands and dot decimals.

const LOCALE = 'en-US';

export function formatUSD(value: number, opts?: { min?: number; max?: number; compact?: boolean }) {
  if (!Number.isFinite(value)) return '$0.00';
  if (opts?.compact) {
    return new Intl.NumberFormat(LOCALE, {
      notation: 'compact',
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }
  const min = opts?.min ?? (Math.abs(value) >= 100_000 ? 0 : 2);
  const max = opts?.max ?? (Math.abs(value) >= 100_000 ? 0 : 2);
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  }).format(value);
}

export function formatUSDHeader(value: number) {
  if (!Number.isFinite(value)) return '$0';
  const min = Math.abs(value) >= 100_000 ? 0 : 2;
  const max = Math.abs(value) >= 100_000 ? 0 : 2;
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  }).format(value);
}

export function formatNumber(value: number, opts?: { min?: number; max?: number }) {
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: opts?.min ?? 0,
    maximumFractionDigits: opts?.max ?? 2,
  }).format(value);
}

// value is a percent number (e.g., 12.34 means 12.34%)
export function formatPercent(value: number, opts?: { min?: number; max?: number }) {
  if (!Number.isFinite(value)) return '0%';
  const s = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: opts?.min ?? 2,
    maximumFractionDigits: opts?.max ?? 2,
  }).format(value);
  return `${s}%`;
}

export function formatTokenAmount(value: number, displayDecimals = 4) {
  if (!Number.isFinite(value)) return '0';
  const threshold = Math.pow(10, -displayDecimals);
  if (value > 0 && value < threshold) return `< ${threshold.toLocaleString(LOCALE)}`;
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: displayDecimals,
    maximumFractionDigits: displayDecimals,
  }).format(value);
}

export const NUMBER_LOCALE = LOCALE;


