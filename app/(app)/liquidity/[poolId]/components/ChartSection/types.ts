import type { ChartType } from "./hooks";
import type { ChartDataPoint } from "../../hooks";

export interface ChartSectionProps {
  chartData: ChartDataPoint[];
  /** Raw fee events — when present with per-event timestamps, enables granular fee chart */
  feeEvents?: import("../../hooks/usePoolChartData").FeeEvent[];
  isLoading: boolean;
  windowWidth: number;
  chartType?: ChartType;
  onChartTypeChange?: (type: ChartType) => void;
  poolId?: string;
  token0Symbol?: string;
  token1Symbol?: string;
  yieldSources?: Array<'aave'>;
  currentSwapApr?: number;
  networkMode?: string;
  /** Pool type — drives fee chart rendering (Volatile: per-event, Stable: daily with Activity/Target) */
  poolType?: string;
}

// Time period options
export type TimePeriod = "1D" | "1W" | "1M";

// Hover state for chart values
export interface HoverData {
  date: string;
  fee?: number;
  activity?: number;
  target?: number;
  volume?: number;
  tvl?: number;
  volatility?: number;
  agentAdjustment?: number;
  buyFee?: number;
  sellFee?: number;
}
