/** Local number formatter matching the legacy formatNumber(value, {min?, max?}) API */
export function formatNumber(
  value: number,
  opts?: { min?: number; max?: number }
): string {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: opts?.min ?? 0,
    maximumFractionDigits: opts?.max ?? 2,
  }).format(value);
}

// Chart skeleton for dynamic import loading - matches chart height (380px) to prevent CLS
export const CHART_HEIGHT_PX = 380;
export const PRICE_SCALE_WIDTH = 70;
export const TIME_SCALE_HEIGHT = 26;
