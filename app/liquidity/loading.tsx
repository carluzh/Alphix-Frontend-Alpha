import { Skeleton } from "@/components/ui/skeleton"
import { AppLayout } from "@/components/app-layout"
import { Filter as FilterIcon } from "lucide-react"

export default function LiquidityLoading() {
  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="flex flex-1 flex-col p-6 px-10">
          <div className="mb-2">
            <div className="flex items-stretch justify-between gap-4">
              <div className="flex flex-col">
                <h2 className="text-xl font-semibold">Liquidity Pools</h2>
                <p className="text-sm text-muted-foreground">Explore and manage your liquidity positions.</p>
                <div className="mt-4">
                  <div className="rounded-lg border border-dashed border-sidebar-border/60 bg-muted/10 p-2 md:p-4">
                    <div className="flex items-stretch gap-1.5 md:gap-3">
                      {['TVL', 'VOLUME (24H)', 'FEES (24H)'].map((label) => (
                        <div key={label} className="w-[140px] md:w-[180px] rounded-lg bg-muted/30 border border-sidebar-border/60">
                          <div className="px-3 md:px-4 h-7 md:h-9 flex items-center">
                            <span className="text-[10px] md:text-xs tracking-wider text-muted-foreground font-mono font-bold">{label}</span>
                          </div>
                          <div className="px-3 md:px-4 py-1">
                            <Skeleton className="h-5 w-16 md:h-6 md:w-20" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="hidden md:flex items-end">
                <div className="flex items-center gap-2">
                  <button className="h-8 px-3 rounded-md border border-sidebar-border bg-container text-muted-foreground flex items-center gap-2 text-xs">
                    <FilterIcon className="h-3.5 w-3.5" />
                    <span>Filter</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto isolate">
            <div className="w-full bg-muted/30 border border-sidebar-border/60 rounded-lg overflow-hidden">
              <div className="px-6 py-3 border-b border-sidebar-border/40">
                <div className="flex items-center gap-4">
                  <span className="text-xs text-muted-foreground w-[240px]">Pool</span>
                  <span className="text-xs text-muted-foreground w-[140px]">Volume (24h)</span>
                  <span className="text-xs text-muted-foreground w-[120px]">Fees (24h)</span>
                  <span className="text-xs text-muted-foreground w-[140px]">Liquidity</span>
                  <span className="text-xs text-muted-foreground flex-1 text-right">Yield (7d)</span>
                </div>
              </div>
              {[...Array(6)].map((_, i) => (
                <div key={i} className="px-6 py-4 border-b border-sidebar-border/20 last:border-b-0">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 w-[240px]">
                      <div className="relative w-14 h-7">
                        <Skeleton className="absolute w-7 h-7 rounded-full" style={{ left: 0 }} />
                        <Skeleton className="absolute w-7 h-7 rounded-full" style={{ left: 16 }} />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-3 w-16" />
                      </div>
                    </div>
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-12 ml-6" />
                    <Skeleton className="h-4 w-20 ml-4" />
                    <div className="flex-1 flex justify-end">
                      <Skeleton className="h-6 w-16 rounded-md" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
