import { CHART_HEIGHT_PX, PRICE_SCALE_WIDTH, TIME_SCALE_HEIGHT } from "./constants";

export function ChartLoadingSkeleton() {
  const dotPattern = `radial-gradient(circle, #333333 1px, transparent 1px)`;
  return (
    <div className="flex flex-col gap-4">
      <div className="relative" style={{ height: CHART_HEIGHT_PX }}>
        <div
          className="absolute pointer-events-none"
          style={{
            top: 0,
            left: 0,
            right: PRICE_SCALE_WIDTH,
            bottom: TIME_SCALE_HEIGHT,
            backgroundImage: dotPattern,
            backgroundSize: "24px 24px",
          }}
        />
        <div className="flex flex-row absolute w-full gap-2 items-start z-10">
          <div className="flex flex-col gap-1 p-3 pointer-events-none bg-background rounded-xl">
            <div className="h-9 w-24 bg-muted/20 animate-pulse rounded" />
            <div className="h-4 w-32 bg-muted/10 animate-pulse rounded" />
          </div>
        </div>
      </div>
      {/* Time period selector skeleton */}
      <div className="flex flex-row items-center gap-1 opacity-50">
        {["1W", "1M", "1Y"].map((opt) => (
          <div key={opt} className="h-7 px-2.5 text-xs rounded-md bg-muted/20 text-muted-foreground">
            {opt}
          </div>
        ))}
      </div>
    </div>
  );
}

export function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-6 p-3 sm:p-6 w-full max-w-[1200px] mx-auto animate-pulse">
      <div className="h-8 w-48 bg-muted/40 rounded" />
      <div className="flex flex-col xl:flex-row gap-10">
        <div className="flex-1 flex flex-col gap-6 w-full">
          <div className="h-12 bg-muted/40 rounded" />
          <div className="h-[380px] bg-muted/20 rounded-lg" />
          <div className="h-24 bg-muted/40 rounded-lg" />
        </div>
        <div className="flex flex-col gap-5 w-full xl:w-[380px]">
          <div className="h-48 bg-muted/40 rounded-lg" />
          <div className="h-48 bg-muted/40 rounded-lg" />
          <div className="h-36 bg-muted/40 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
