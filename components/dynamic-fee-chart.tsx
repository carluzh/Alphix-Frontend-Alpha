"use client"

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { CartesianGrid, Line, LineChart, XAxis, YAxis, Legend, Tooltip } from "recharts"

interface FeeHistoryPoint {
  timeLabel: string;       // e.g., "Day 1, 00:00"
  volumeTvlRatio: number;  // e.g., 1.1
  emaRatio: number;        // e.g., 1.05
  dynamicFee: number;      // e.g., 0.31 for 0.31% (stored as percentage points)
}

interface DynamicFeeChartProps {
  data: FeeHistoryPoint[];
}

const chartConfig = {
  volumeTvlRatio: {
    label: "Vol/TVL Ratio",
    color: "hsl(var(--chart-3))",
  },
  emaRatio: {
    label: "EMA (Vol/TVL)",
    color: "hsl(var(--chart-2))",
  },
  dynamicFee: {
    label: "Dynamic Fee (%)",
    color: "#e85102",
  },
} satisfies ChartConfig;

// Helper to generate mock data based on the rules
export const generateMockFeeHistory = (days = 30, pointsPerDay = 4): FeeHistoryPoint[] => {
  const data: FeeHistoryPoint[] = [];
  let currentFeePercent = 0.3; // Start at 0.3%
  let dailyFeeChangeAppliedThisDayPercent = 0;
  let lastDayProcessed = -1;
  const emaPeriod = 10 * pointsPerDay; // EMA over 10 "days" of data points
  const ratios: number[] = [];
  const emaValues: number[] = [];

  for (let dayIndex = 0; dayIndex < days; dayIndex++) {
    for (let intervalIndex = 0; intervalIndex < pointsPerDay; intervalIndex++) {
      const pointGlobalIndex = dayIndex * pointsPerDay + intervalIndex;
      const timeLabel = `D${dayIndex + 1} H${String(intervalIndex * (24 / pointsPerDay)).padStart(2, '0')}`;

      // 1. Simulate Vol/TVL Ratio
      const prevRatio = ratios.length > 0 ? ratios[ratios.length - 1] : 1.0;
      let change = (Math.random() - 0.5) * 0.15; // Volatility
      if (pointGlobalIndex % (2 * pointsPerDay) === 0) change += (Math.random() -0.5) * 0.3; // bigger swings every 2 days
      let volumeTvlRatio = Math.max(0.7, Math.min(1.3, parseFloat((prevRatio + change).toFixed(4)) ));
      ratios.push(volumeTvlRatio);

      // 2. Calculate EMA of Vol/TVL Ratio
      let emaRatio: number;
      if (ratios.length < emaPeriod || emaValues.length === 0) {
        const sum = ratios.slice(Math.max(0, ratios.length - emaPeriod)).reduce((s, r) => s + r, 0);
        emaRatio = parseFloat((sum / Math.min(ratios.length, emaPeriod)).toFixed(4));
      } else {
        const k = 2 / (emaPeriod + 1);
        const prevEma = emaValues[emaValues.length - 1];
        emaRatio = parseFloat((volumeTvlRatio * k + prevEma * (1 - k)).toFixed(4));
      }
      emaValues.push(emaRatio);

      // 3. Calculate Dynamic Fee
      if (dayIndex !== lastDayProcessed) {
        dailyFeeChangeAppliedThisDayPercent = 0;
        lastDayProcessed = dayIndex;
      }

      let feeAdjustmentDirection = 0;
      const deadband = 0.02; // Only adjust fee if ratio is significantly different from EMA
      if (volumeTvlRatio > emaRatio + deadband) {
        feeAdjustmentDirection = 1; // Ratio significantly above EMA, fee should increase
      } else if (volumeTvlRatio < emaRatio - deadband) {
        feeAdjustmentDirection = -1; // Ratio significantly below EMA, fee should decrease
      }

      const feeStepPercent = 0.01;
      const proposedStepPercent = feeStepPercent * feeAdjustmentDirection;

      if (feeAdjustmentDirection !== 0) {
        // Check daily cap: total change today (positive or negative) should not exceed 0.01%
        if (Math.abs(dailyFeeChangeAppliedThisDayPercent + proposedStepPercent) <= (feeStepPercent + 0.00001)) { // check against 0.01 with tolerance
          currentFeePercent += proposedStepPercent;
          dailyFeeChangeAppliedThisDayPercent += proposedStepPercent;
        } else if (Math.abs(dailyFeeChangeAppliedThisDayPercent) < (feeStepPercent + 0.00001) && Math.sign(proposedStepPercent) !== Math.sign(dailyFeeChangeAppliedThisDayPercent) && dailyFeeChangeAppliedThisDayPercent !== 0) {
          // Allow reversal if not exceeding individual step magnitude and not exceeding daily magnitude when crossing zero
           const remainingDailyAllowance = feeStepPercent - Math.abs(dailyFeeChangeAppliedThisDayPercent);
           const actualChange = Math.sign(proposedStepPercent) * Math.min(Math.abs(proposedStepPercent), remainingDailyAllowance);
           currentFeePercent += actualChange;
           dailyFeeChangeAppliedThisDayPercent += actualChange;
        } else if (dailyFeeChangeAppliedThisDayPercent === 0) { // First change of the day
            currentFeePercent += proposedStepPercent;
            dailyFeeChangeAppliedThisDayPercent += proposedStepPercent;
        }
      }
      // Clamp fee: e.g., min 0.05%, max 1.0%
      currentFeePercent = Math.max(0.05, Math.min(1.0, parseFloat(currentFeePercent.toFixed(4)) ));
      
      data.push({
        timeLabel,
        volumeTvlRatio,
        emaRatio,
        dynamicFee: currentFeePercent, // Store as percentage points
      });
    }
  }
  return data;
};

export function DynamicFeeChart({ data }: DynamicFeeChartProps) {
  if (!data || data.length === 0) {
    return (
      <Card className="w-full max-w-3xl shadow-xl rounded-lg">
        <CardHeader className="w-full">
          <CardDescription>No historical data available.</CardDescription>
        </CardHeader>
        <CardContent className="w-full flex items-center justify-center h-[300px]">
          <p>Loading data or data is empty.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-3xl shadow-xl rounded-lg">
      <CardHeader className="w-full pt-4 pb-2">
      </CardHeader>
      <CardContent className="w-full">
        <ChartContainer config={chartConfig} className="h-[300px] w-full">
          <LineChart
            data={data}
            margin={{
              top: 5,
              right: 20, // Increased right margin for YAxis labels
              left: 5,  // Increased left margin
              bottom: 5,
            }}
          >
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="timeLabel"
              tickLine={false}
              axisLine={false}
              tickMargin={10}
              tickFormatter={(value, index) => {
                // Ensure value is a string before using string methods
                const valueStr = String(value);
                const approxTotalDays = data.length / 4; 
                if (data.length > 30 && index % Math.floor(data.length / (approxTotalDays / 5)) !== 0 && index !== data.length -1) return ''; 
                return valueStr.startsWith("D") ? valueStr.split(" H")[0] : valueStr;
              }}
              tick={{ fontSize: '0.75rem' }}
            />
            <YAxis
              yAxisId="left"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(value) => value.toFixed(2)}
              domain={['auto', 'auto']}
              stroke="hsl(var(--muted-foreground))"
              tick={{ fontSize: '0.75rem' }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(value) => `${value.toFixed(2)}%`}
              domain={['auto', 'auto']}
              stroke="hsl(var(--muted-foreground))"
              tick={{ fontSize: '0.75rem' }}
            />
            <ChartTooltip
              cursor={true}
              content={<ChartTooltipContent 
                className="bg-card text-card-foreground border shadow-lg rounded-md p-2 text-xs min-w-[180px]"
                formatter={(value, name, item, payload) => {
                  const configEntry = chartConfig[name as keyof typeof chartConfig];
                  const seriesName = configEntry ? configEntry.label : name;
                  const seriesColor = item?.color || (configEntry ? configEntry.color : '#8884d8');

                  let formattedValue = typeof value === 'number' ? value.toFixed(4) : value;
                  if (name === 'dynamicFee' && typeof value === 'number') {
                    formattedValue = `${value.toFixed(4)}%`;
                  }

                  return (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{seriesName}:</span>
                      <span style={{ color: seriesColor }} className="font-medium">{formattedValue}</span>
                    </div>
                  );
                }}
              />}
            />
            <Legend 
              verticalAlign="top" 
              height={36} 
              wrapperStyle={{fontSize: "0.75rem"}}
              formatter={(value, entry: any, index) => {
                const name = entry.payload && entry.payload.name;
                return <span style={{ color: 'hsl(var(--muted-foreground))' }}>{name || value}</span>;
              }}
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="volumeTvlRatio"
              strokeWidth={2}
              dot={false}
              stroke={chartConfig.volumeTvlRatio.color}
              name={chartConfig.volumeTvlRatio.label}
              isAnimationActive={false}
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="emaRatio"
              strokeWidth={2}
              dot={false}
              stroke={chartConfig.emaRatio.color}
              name={chartConfig.emaRatio.label}
              strokeDasharray="5 5"
              isAnimationActive={false}
            />
            <Line
              yAxisId="right"
              type="stepAfter"
              dataKey="dynamicFee"
              strokeWidth={2}
              dot={false}
              stroke={chartConfig.dynamicFee.color}
              name={chartConfig.dynamicFee.label}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
      <CardFooter className="flex flex-col items-start text-sm text-muted-foreground pt-0 pb-4 px-4">
        <p className="text-xs">
          This graph illustrates the relationship between the Volume/TVL ratio, its Exponential Moving Average (EMA), 
          and the dynamically adjusted trading fee over the period shown. 
          <span className="italic"> This is placeholder data for demonstration.</span>
        </p>
      </CardFooter>
    </Card>
  );
} 