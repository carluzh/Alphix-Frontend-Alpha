"use client";

export function YieldChartSkeleton() {
  const dotPattern = `radial-gradient(circle, #333333 1px, transparent 1px)`;
  return (
    <div className="flex flex-col gap-4">
      <div className="relative" style={{ height: 300 }}>
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ backgroundImage: dotPattern, backgroundSize: "24px 24px" }}
        />
        <div className="flex flex-col gap-1 p-3 bg-background rounded-xl absolute z-10">
          <div className="h-9 w-20 bg-muted/20 animate-pulse rounded" />
          <div className="h-4 w-32 bg-muted/10 animate-pulse rounded" />
        </div>
      </div>
      <div className="flex flex-row items-center gap-1 opacity-50">
        {["1W", "1M"].map((opt) => (
          <div key={opt} className="h-7 px-2.5 text-xs rounded-md bg-muted/20 text-muted-foreground">{opt}</div>
        ))}
      </div>
    </div>
  );
}
