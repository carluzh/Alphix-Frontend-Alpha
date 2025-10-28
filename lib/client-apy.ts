export function calculateClientAPY(
  uncollectedFeesUSD: number,
  positionValueUSD: number,
  lastModificationTimestamp: number,
  poolAPY?: number | null
): { apy: number | null; formattedAPY: string; isFallback: boolean } {
  const nowTimestamp = Math.floor(Date.now() / 1000);
  const durationDays = (nowTimestamp - lastModificationTimestamp) / 86400;

  const shouldUseFallback =
    durationDays < 0.25 ||
    positionValueUSD <= 0 ||
    uncollectedFeesUSD <= 0;

  if (shouldUseFallback) {
    if (poolAPY !== undefined && poolAPY !== null && poolAPY >= 0) {
      return { apy: poolAPY, formattedAPY: formatAPY(poolAPY), isFallback: true };
    }
    return { apy: null, formattedAPY: '—', isFallback: false };
  }

  const apy = Math.max((uncollectedFeesUSD / positionValueUSD) * (365 / durationDays) * 100, 0);

  if (isFinite(apy)) {
    return { apy, formattedAPY: formatAPY(apy), isFallback: false };
  }

  if (poolAPY !== undefined && poolAPY !== null && poolAPY >= 0) {
    return { apy: poolAPY, formattedAPY: formatAPY(poolAPY), isFallback: true };
  }

  return { apy: null, formattedAPY: '—', isFallback: false };
}

function formatAPY(apy: number | null): string {
  if (apy === null || apy === undefined || !isFinite(apy)) return '—';
  if (apy === 0) return '0%';
  if (apy >= 1000) return `${Math.round(apy)}%`;
  if (apy >= 100) return `${apy.toFixed(0)}%`;
  if (apy >= 10) return `${apy.toFixed(1)}%`;
  return `${apy.toFixed(2)}%`;
}
