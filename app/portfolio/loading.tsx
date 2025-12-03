import { Skeleton } from "@/components/ui/skeleton"
import { AppLayout } from "@/components/app-layout"
import { Folder, Rows3 } from "lucide-react"

export default function PortfolioLoading() {
  return (
    <AppLayout>
      <div className="flex flex-1 flex-col p-3 sm:p-6 sm:px-10">
        <div className="grid items-start relative" style={{ gridTemplateColumns: "minmax(240px, max-content) minmax(240px, max-content) 1fr", gridTemplateRows: "auto auto", columnGap: "1rem" }}>
          <div className="col-[1] row-[1/3] rounded-lg bg-muted/30 border border-sidebar-border/60 p-4 h-full flex flex-col justify-between">
            <div>
              <span className="text-xs tracking-wider text-muted-foreground font-mono font-bold mb-3 block">CURRENT VALUE</span>
              <div className="flex flex-col gap-2">
                <Skeleton className="h-10 w-40" />
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-12" />
                </div>
              </div>
            </div>
          </div>
          <div className="col-[2] row-[1/3] rounded-lg bg-muted/30 border border-sidebar-border/60 py-1.5 px-4 h-full flex flex-col justify-center hidden min-[1400px]:flex">
            <div className="w-full divide-y divide-sidebar-border/40">
              <div className="flex justify-between items-center py-1.5">
                <span className="text-[11px] tracking-wider text-muted-foreground font-mono font-bold uppercase">Positions</span>
                <Skeleton className="h-3 w-6" />
              </div>
              <div className="flex justify-between items-center py-1.5">
                <span className="text-[11px] tracking-wider text-muted-foreground font-mono font-bold uppercase">Net APY</span>
                <Skeleton className="h-3 w-10" />
              </div>
              <div className="flex justify-between items-center py-1.5">
                <span className="text-[11px] tracking-wider text-muted-foreground font-mono font-bold uppercase">Unclaimed</span>
                <Skeleton className="h-3 w-12" />
              </div>
            </div>
          </div>
          <div className="col-[3] row-[1] rounded-lg bg-muted/30 border border-sidebar-border/60 p-1.5 pr-3 pl-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <Skeleton className="h-6 w-24 rounded-md mr-2" />
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="h-6 w-6 rounded" />
                <Skeleton className="h-6 w-6 rounded" />
              </div>
            </div>
          </div>
          <div className="col-[3] row-[2] rounded-lg bg-muted/30 border border-sidebar-border/60 p-3 h-[52px] flex items-center gap-2 overflow-hidden">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-7 w-16 rounded-full flex-shrink-0" />
            ))}
          </div>
        </div>
        <div className="mt-4 space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="rounded-lg border border-sidebar-border bg-muted/30 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="relative w-10 h-6">
                    <Skeleton className="absolute w-6 h-6 rounded-full" style={{ left: 0 }} />
                    <Skeleton className="absolute w-6 h-6 rounded-full" style={{ left: 12 }} />
                  </div>
                  <div className="space-y-1">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
                <Skeleton className="hidden lg:block h-9 w-[180px] rounded" />
              </div>
              <div className="flex items-center gap-6 pt-2 border-t border-sidebar-border/40">
                <div className="space-y-1">
                  <Skeleton className="h-4 w-16" />
                  <span className="text-[10px] text-muted-foreground">Position</span>
                </div>
                <div className="space-y-1">
                  <Skeleton className="h-4 w-14" />
                  <span className="text-[10px] text-muted-foreground">Fees</span>
                </div>
                <div className="space-y-1">
                  <Skeleton className="h-4 w-12" />
                  <span className="text-[10px] text-muted-foreground">APY</span>
                </div>
                <div className="hidden lg:block space-y-1">
                  <Skeleton className="h-4 w-24" />
                  <span className="text-[10px] text-muted-foreground">Range</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  )
}
