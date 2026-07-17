/**
 * Shared utilities for chart time range calculations
 *
 * Ensures charts display the FULL selected period (1D, 1W, 1M, 1Y, ALL)
 * rather than fitting to available data. This prevents issues like:
 * - X-axis labels showing "13.01 13.01 13.01" when data only spans hours
 * - Data stretching across full chart width regardless of actual coverage
 *
 * With these utilities, selecting "1W" will show a 7-day span with proper
 * tick marks, and data will only appear where it actually exists.
 */


// Period types used across charts
export type ChartPeriodOverview = "DAY" | "WEEK" | "MONTH";
export type ChartPeriodPosition = "1W" | "1M" | "1Y" | "ALL";
export type ChartPeriodPool = "1D" | "1W" | "1M" | "All";

/**
 * Get period duration in milliseconds
 */
function getPeriodMs(period: ChartPeriodOverview | ChartPeriodPosition | ChartPeriodPool): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  switch (period) {
    case "DAY":
    case "1D":
      return MS_PER_DAY;
    case "WEEK":
    case "1W":
      return 7 * MS_PER_DAY;
    case "MONTH":
    case "1M":
      return 30 * MS_PER_DAY;
    case "1Y":
      return 365 * MS_PER_DAY;
    case "ALL":
    case "All":
      // For ALL, return a large duration - actual range will be computed from data
      return 365 * 5 * MS_PER_DAY; // 5 years
    default:
      return 7 * MS_PER_DAY;
  }
}

/**
 * Calculate the time range for a given period.
 * Returns [fromTimestamp, toTimestamp] in UNIX seconds.
 *
 * @param period - The selected time period
 * @param referenceTime - Optional reference time (defaults to now)
 * @returns Tuple of [fromTimestamp, toTimestamp] in seconds
 */
export function calculatePeriodRange(
  period: ChartPeriodOverview | ChartPeriodPosition | ChartPeriodPool,
  referenceTime?: number
): [number, number] {
  const now = referenceTime ?? Math.floor(Date.now() / 1000);
  const periodMs = getPeriodMs(period);
  const periodSeconds = Math.floor(periodMs / 1000);

  return [now - periodSeconds, now];
}

/**
 * Generate evenly spaced tick values for a time range.
 * Used by Recharts charts to display consistent x-axis labels.
 *
 * @param from - Start timestamp in seconds
 * @param to - End timestamp in seconds
 * @param tickCount - Desired number of ticks (default: 5)
 * @returns Array of tick timestamps in seconds
 */
function generateTimeTicks(from: number, to: number, tickCount: number = 5): number[] {
  if (tickCount < 2) return [from, to];

  const ticks: number[] = [];
  const step = (to - from) / (tickCount - 1);

  for (let i = 0; i < tickCount; i++) {
    ticks.push(Math.floor(from + step * i));
  }

  return ticks;
}

/**
 * Generate tick values appropriate for the selected period.
 * Automatically determines good tick spacing based on period type.
 *
 * @param period - The selected time period
 * @param from - Start timestamp in seconds
 * @param to - End timestamp in seconds
 * @returns Array of tick timestamps in seconds
 */
export function generateTicksForPeriod(
  period: ChartPeriodOverview | ChartPeriodPosition | ChartPeriodPool,
  from: number,
  to: number
): number[] {
  switch (period) {
    case "DAY":
    case "1D":
      // For 1 day, show ~6 ticks (every 4 hours)
      return generateTimeTicks(from, to, 7);
    case "WEEK":
    case "1W":
      // For 1 week, show 7 ticks (one per day)
      return generateTimeTicks(from, to, 8);
    case "MONTH":
    case "1M":
      // For 1 month, show ~5-6 ticks (every ~5-6 days)
      return generateTimeTicks(from, to, 6);
    case "1Y":
      // For 1 year, show ~12 ticks (monthly)
      return generateTimeTicks(from, to, 13);
    case "ALL":
    case "All":
      // For ALL, use 6 evenly spaced ticks
      return generateTimeTicks(from, to, 6);
    default:
      return generateTimeTicks(from, to, 5);
  }
}

/**
 * Format tick value based on period type.
 * Returns appropriate date/time format for the period granularity.
 *
 * @param timestamp - Timestamp in seconds
 * @param period - The selected time period
 * @returns Formatted string
 */
export function formatTickForPeriod(
  timestamp: number,
  period: ChartPeriodOverview | ChartPeriodPosition | ChartPeriodPool
): string {
  const date = new Date(timestamp * 1000);

  switch (period) {
    case "DAY":
    case "1D":
      // Show hours for 1 day view
      return date.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    case "WEEK":
    case "1W":
      // Show weekday for 1 week view
      return date.toLocaleDateString("en-US", { weekday: "short" });
    case "MONTH":
    case "1M":
      // Show month/day for 1 month view
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    case "1Y":
      // Show month for 1 year view
      return date.toLocaleDateString("en-US", { month: "short" });
    case "ALL":
    case "All":
      // Show month/year for all time
      return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    default:
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
}


