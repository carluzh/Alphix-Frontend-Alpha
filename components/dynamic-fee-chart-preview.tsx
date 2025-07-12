"use client"

import { LineChart, Line, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ArrowRightIcon } from "lucide-react";
import Image from "next/image";
import { getToken } from "@/lib/pools-config";

interface FeeHistoryPoint {
  timeLabel: string;
  volumeTvlRatio: number;
  emaRatio: number;
  dynamicFee: number; // Expecting percentage points, e.g., 0.31 for 0.31%
}

interface DynamicFeeChartPreviewProps {
  data: FeeHistoryPoint[];
  onClick?: () => void; // To handle click for opening the modal
  poolInfo?: {
    token0Symbol: string;
    token1Symbol: string;
    poolName: string;
  };
  isLoading?: boolean; // Show loading state during pool switches
}

export function DynamicFeeChartPreview({ data, onClick, poolInfo, isLoading = false }: DynamicFeeChartPreviewProps) {
  // Show loading state while data is being fetched
  if (isLoading || !data || data.length === 0) {
    return (
      <Card 
        className="w-full max-w-md shadow-md rounded-lg cursor-pointer hover:shadow-lg transition-shadow bg-muted/30 group"
        onClick={onClick}
      >
        <CardHeader className="flex flex-row items-start justify-between pb-2 pt-3 px-4">
          <div className="space-y-0.5">
                          <CardTitle className="text-sm font-medium">Dynamic Fee Trend</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                  {poolInfo ? (
                    <div className="flex items-center">
                      <div className="relative w-8 h-4">
                        <div className="absolute top-0 left-0 w-4 h-4 rounded-full overflow-hidden bg-background border border-border/50">
                          <Image 
                            src={getToken(poolInfo.token0Symbol)?.icon || "/placeholder-logo.svg"} 
                            alt={poolInfo.token0Symbol} 
                            width={16} 
                            height={16} 
                            className="w-full h-full object-cover" 
                          />
                        </div>
                        <div className="absolute top-0 left-2.5 w-4 h-4 rounded-full overflow-hidden bg-background border border-border/50">
                          <Image 
                            src={getToken(poolInfo.token1Symbol)?.icon || "/placeholder-logo.svg"} 
                            alt={poolInfo.token1Symbol} 
                            width={16} 
                            height={16} 
                            className="w-full h-full object-cover" 
                          />
                        </div>
                      </div>
                      <span>{poolInfo.token0Symbol}/{poolInfo.token1Symbol}</span>
                    </div>
                  ) : (
                    "30-Day Fee Snapshot"
                  )}
              </CardDescription>
          </div>
          <ArrowRightIcon className="h-4 w-4 text-muted-foreground group-hover:text-white transition-colors duration-150" />
        </CardHeader>
        <CardContent className="px-2 pb-2 pt-0 h-[80px]">
          <div className="w-full h-full flex items-center justify-center">
            {isLoading ? (
              <div className="w-full h-full bg-muted/40 rounded animate-pulse"></div>
            ) : (
              <div className="text-xs text-muted-foreground">No data available</div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  const volumeTvlRatios = data.map(point => point.volumeTvlRatio);
  const emaRatios = data.map(point => point.emaRatio);
  const dynamicFees = data.map(point => point.dynamicFee);

  // Check if data has variation
  const nonZeroVolume = volumeTvlRatios.filter(v => v > 0);
  const nonZeroEma = emaRatios.filter(v => v > 0);
  const hasVariation = nonZeroVolume.length > 0 || nonZeroEma.length > 0;

  // Find the max values for better scaling
  const maxVolume = Math.max(...volumeTvlRatios);
  const maxEma = Math.max(...emaRatios);
  const maxFee = Math.max(...dynamicFees);
  const minFee = Math.min(...dynamicFees);

  // Smart normalization for sparse data with better spike visibility
  const chartData = data.map((point, index) => {
    // Volume normalization: make spikes more visible in preview
    let normalizedVolume = 40; // Lower baseline to make spikes more prominent
    if (point.volumeTvlRatio > 0 && nonZeroVolume.length > 0) {
      const minNonZeroVolume = Math.min(...volumeTvlRatios.filter(v => v > 0));
      // Use a more aggressive scaling to make spikes visible
      const volumeScale = Math.min(point.volumeTvlRatio / maxVolume, 1); // Cap at 100%
      normalizedVolume = 40 + (volumeScale * 140); // Scale from 40 to 180
    }

    // EMA normalization: similar approach but more conservative
    let normalizedEma = 45;
    if (point.emaRatio > 0 && nonZeroEma.length > 0) {
      const minNonZeroEma = Math.min(...emaRatios.filter(v => v > 0));
      const emaScale = Math.min(point.emaRatio / maxEma, 1);
      normalizedEma = 45 + (emaScale * 100); // Scale from 45 to 145
    }

    // Fee normalization: keep in middle range
    let normalizedFee = 90; // Middle of chart
    if (maxFee > minFee) {
      normalizedFee = 80 + ((point.dynamicFee - minFee) / (maxFee - minFee)) * 40; // 80 to 120
    }

    return {
      name: index,
      volume: normalizedVolume,
      ema: normalizedEma,
      fee: normalizedFee,
    };
  });

  // Expand Y-axis domain to ensure all data is visible
  const effectiveMinValue = 20;
  const effectiveMaxValue = 200;

  return (
    <Card 
      className="w-full max-w-md shadow-md rounded-lg cursor-pointer hover:shadow-lg transition-shadow bg-muted/30 group"
      onClick={onClick}
    >
      <CardHeader className="flex flex-row items-start justify-between pb-2 pt-3 px-4">
        <div className="space-y-0.5">
            <CardTitle className="text-sm font-medium">Dynamic Fee Trend</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
                {poolInfo ? (
                  <div className="flex items-center">
                    {/* Overlapping token icons - smaller version */}
                    <div className="relative w-8 h-4">
                      <div className="absolute top-0 left-0 w-4 h-4 rounded-full overflow-hidden bg-background border border-border/50">
                        <Image 
                          src={getToken(poolInfo.token0Symbol)?.icon || "/placeholder-logo.svg"} 
                          alt={poolInfo.token0Symbol} 
                          width={16} 
                          height={16} 
                          className="w-full h-full object-cover" 
                        />
                      </div>
                      <div className="absolute top-0 left-2.5 w-4 h-4 rounded-full overflow-hidden bg-background border border-border/50">
                        <Image 
                          src={getToken(poolInfo.token1Symbol)?.icon || "/placeholder-logo.svg"} 
                          alt={poolInfo.token1Symbol} 
                          width={16} 
                          height={16} 
                          className="w-full h-full object-cover" 
                        />
                      </div>
                    </div>
                    {/* Pool pair name */}
                    <span>{poolInfo.token0Symbol}/{poolInfo.token1Symbol}</span>
                  </div>
                ) : (
                  "30-Day Fee Snapshot"
                )}
            </CardDescription>
        </div>
        <ArrowRightIcon className="h-4 w-4 text-muted-foreground group-hover:text-white transition-colors duration-150" />
      </CardHeader>
      <CardContent className="px-2 pb-2 pt-0 h-[80px]">
        <div className="w-full h-full cursor-pointer [&_.recharts-wrapper]:outline-none [&_.recharts-wrapper]:focus:outline-none [&_.recharts-surface]:outline-none">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart 
              data={chartData}
              margin={{ top: 5, right: 8, bottom: 5, left: 8 }}
              style={{ cursor: 'pointer' }}
            >
              <XAxis dataKey="name" hide={true} />
              <YAxis 
                hide={true} 
                domain={[effectiveMinValue, effectiveMaxValue]}
              />
              {/* Volume/TVL Ratio Line */}
              <Line
                type="monotone"
                dataKey="volume"
                stroke={"hsl(var(--chart-3))"} // Using chart-3 color (same as main chart)
                strokeWidth={1.5}
                dot={false}
                activeDot={false}
              />
              {/* EMA Line */}
              <Line
                type="monotone"
                dataKey="ema"
                stroke={"hsl(var(--chart-2))"} // Using chart-2 color (same as main chart)
                strokeWidth={1}
                strokeDasharray="3 3" // Dashed line for EMA
                dot={false}
                activeDot={false}
              />
              {/* Dynamic Fee Line */}
              <Line
                type="stepAfter"
                dataKey="fee"
                stroke={"#e85102"} // Same color as main chart's dynamic fee
                strokeWidth={1.5}
                dot={false}
                activeDot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
} 