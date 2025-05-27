"use client"

import { LineChart, Line, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ArrowRightIcon } from "lucide-react";
import { motion } from "framer-motion";

interface FeeHistoryPoint {
  timeLabel: string;
  volumeTvlRatio: number;
  emaRatio: number;
  dynamicFee: number; // Expecting percentage points, e.g., 0.31 for 0.31%
}

interface DynamicFeeChartPreviewProps {
  data: FeeHistoryPoint[];
  onClick?: () => void; // To handle click for opening the modal
}

export function DynamicFeeChartPreview({ data, onClick }: DynamicFeeChartPreviewProps) {
  if (!data || data.length === 0) {
    return null; // Don't render if no data
  }

  // Prepare data for the preview chart (dynamicFee and EMA), normalized
  const initialFee = data[0].dynamicFee;
  const initialEma = data[0].emaRatio;

  // Calculate max absolute EMA ratio in the dataset if initialEma is 0
  let maxAbsEmaRatio = 0;
  if (initialEma === 0) {
    data.forEach(point => {
      if (Math.abs(point.emaRatio) > maxAbsEmaRatio) {
        maxAbsEmaRatio = Math.abs(point.emaRatio);
      }
    });
  }

  const chartData = data.map((point, index) => {
    let normalizedEma;
    if (initialEma !== 0) {
      normalizedEma = (point.emaRatio / initialEma) * 100;
    } else {
      // initialEma is 0
      if (maxAbsEmaRatio !== 0) {
        // If there's variation later, normalize against the max absolute value in the series
        // This scales the line to show its shape, with its peak (or trough) scaled towards 100 or -100
        normalizedEma = (point.emaRatio / maxAbsEmaRatio) * 100;
      } else {
        // All emaRatios are 0 (or initialEma was 0 and no other variation)
        normalizedEma = 100; // Flat line at 100 as a baseline if no variation from 0
      }
    }

    return {
      name: index, // Simple index for X-axis
      fee: initialFee !== 0 ? (point.dynamicFee / initialFee) * 100 : 100,
      ema: normalizedEma,
    };
  });

  const actualDataLength = chartData.length;

  // Re-calculate min/max for the Y-axis domain based on normalized data
  const yDomainPadding = 0.01; // 1% padding to prevent touching edges
  const allNormalizedValues = chartData.flatMap(d => [d.fee, d.ema]);
  const minValue = Math.min(...allNormalizedValues);
  const maxValue = Math.max(...allNormalizedValues);

  // Ensure a minimum range if all values are the same (e.g., all 100)
  const dataRange = maxValue - minValue;
  const effectiveMinValue = dataRange < 1 ? minValue - 5 : minValue; // Ensure at least a 10-point range if flat
  const effectiveMaxValue = dataRange < 1 ? maxValue + 5 : maxValue;

  return (
    <Card 
      className="w-full max-w-md shadow-md rounded-lg cursor-pointer hover:shadow-lg transition-shadow bg-muted/30 group"
      onClick={onClick}
    >
      <CardHeader className="flex flex-row items-start justify-between pb-2 pt-3 px-4">
        <div className="space-y-0.5">
            <CardTitle className="text-sm font-medium">Dynamic Fee Trend</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
                30-Day Fee Snapshot
            </CardDescription>
        </div>
        <ArrowRightIcon className="h-4 w-4 text-muted-foreground group-hover:text-white transition-colors duration-150" />
      </CardHeader>
      <CardContent className="px-2 pb-2 pt-0 h-[80px]">
        <div className="w-full h-full cursor-pointer">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart 
              data={chartData}
              margin={{ top: 5, right: 8, bottom: 5, left: 8 }}
              style={{ cursor: 'pointer' }}
            >
              <XAxis dataKey="name" hide={true} />
              <YAxis 
                hide={true} 
                domain={[
                  effectiveMinValue * (1 - yDomainPadding),
                  effectiveMaxValue * (1 + yDomainPadding)
                ]}
              />
              <Line
                type="stepAfter"
                dataKey="fee"
                stroke={"#e85102"} // Same color as main chart's dynamic fee
                strokeWidth={1.5}
                dot={(props: any) => {
                  const { cx, cy, stroke, index, payload } = props; // Removed dataLength from destructuring

                  if (index === actualDataLength - 1) { // Use actualDataLength from closure
                    // Render pulsating dot for the LAST point
                    return (
                      <g key={`pulsating-dot-${index}-${payload?.name}`}>
                        <motion.circle
                          cx={cx}
                          cy={cy}
                          r={2.5} 
                          fill={stroke as string}
                          animate={{
                            scale: [1, 1.8, 1, 1.8, 1],
                            opacity: [0.2, 0.5, 0, 0.5, 0],
                          }}
                          transition={{
                            duration: 6,
                            repeat: Infinity,
                            ease: "easeInOut",
                          }}
                        />
                        <circle cx={cx} cy={cy} r={2.5} fill={stroke as string} /> 
                      </g>
                    );
                  } else {
                    return <g key={`empty-dot-${index}-${payload?.name}`} />;
                  }
                }}
              />
              <Line // New line for EMA
                type="monotone"
                dataKey="ema"
                stroke={"hsl(var(--chart-2))"} // Using a color from the main chart's scheme (muted blue/grey)
                strokeWidth={1}
                strokeDasharray="3 3" // Dashed line for EMA
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
} 