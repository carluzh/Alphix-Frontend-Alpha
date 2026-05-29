// Display formatters shared by the swap UI when wired to the kyber-fork engine.

export const formatCurrency = (valueString: string): string => {
  const cleaned = valueString.replace(/[$,~]/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
};

export const formatTokenAmountDisplay = (
  amountString: string,
  tokenOrDecimals?: { decimals: number } | number,
): string => {
  try {
    const amount = parseFloat(amountString);
    if (isNaN(amount) || amount === 0) return '0';

    const maxDecimals = typeof tokenOrDecimals === 'number' ? tokenOrDecimals : tokenOrDecimals?.decimals ?? 6;
    const FLOOR = 0.00001;

    if (amount > 0 && amount < FLOOR) {
      return `< ${FLOOR.toFixed(Math.min(5, maxDecimals))}`;
    }
    if (amount < 0.1) {
      return amount.toPrecision(Math.min(6, maxDecimals + 1));
    }
    if (amount < 1) {
      const formatted = amount.toFixed(Math.min(5, maxDecimals));
      return parseFloat(formatted).toString();
    }
    if (amount < 10000) {
      const formatted = amount.toFixed(Math.min(2, maxDecimals));
      return parseFloat(formatted).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch {
    return amountString;
  }
};
