import { Skeleton } from "@/components/ui/skeleton"
import { AppLayout } from "@/components/app-layout"
import { ChevronLeft } from "lucide-react"

export default function PoolLoading() {
  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="flex flex-1 flex-col p-3 sm:p-6 max-w-full overflow-hidden">
          <div className="flex flex-col min-[1500px]:flex-row gap-6 min-w-0 max-w-full overflow-hidden">
            <div className="flex-1 min-w-0 flex flex-col space-y-3">
              <div className="mt-3 sm:mt-0">
                <div className="md:hidden space-y-3 overflow-x-hidden mb-2">
                  <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 block">
                    <div className="px-4 py-3 flex items-center w-full">
                      <div className="flex items-center gap-1 min-w-0">
                        <ChevronLeft className="h-4 w-4 text-muted-foreground mr-1 flex-shrink-0" />
                        <div className="relative w-16 h-8 mr-0.5">
                          <Skeleton className="absolute w-8 h-8 rounded-full" style={{ left: 0, top: 0 }} />
                          <Skeleton className="absolute w-8 h-8 rounded-full" style={{ left: 20, top: 0 }} />
                        </div>
                        <div className="flex flex-col gap-1">
                          <Skeleton className="h-5 w-28" />
                          <div className="flex items-center gap-3">
                            <Skeleton className="h-4 w-14 rounded-md" />
                            <Skeleton className="h-3 w-10" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-dashed border-sidebar-border/60 bg-muted/10 p-4 mb-2 w-full">
                    <div className="grid grid-cols-2 gap-3">
                      {['VOLUME (24H)', 'FEES (24H)', 'TVL', 'APY'].map((label) => (
                        <div key={label} className="rounded-lg bg-muted/30 border border-sidebar-border/60">
                          <div className="flex items-center px-4 h-9">
                            <span className="text-xs tracking-wider text-muted-foreground font-mono font-bold">{label}</span>
                          </div>
                          <div className="px-4 py-1">
                            <Skeleton className="h-5 w-20" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="hidden md:block">
                  <div className="rounded-lg border border-dashed border-sidebar-border/60 bg-muted/10 p-4 mb-3 w-full">
                    <div className="flex items-stretch gap-3 min-w-0">
                      <div
                        className="flex-shrink-0 rounded-lg bg-muted/30 border border-sidebar-border/60 flex items-center justify-center"
                        style={{ width: '74px', height: '74px' }}
                      >
                        <ChevronLeft className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 basis-0 flex-1 overflow-hidden rounded-lg bg-muted/30 border border-sidebar-border/60">
                        <div className="px-4 py-3 flex items-center w-full min-w-0">
                          <div className="flex items-center gap-1 min-w-0 flex-1">
                            <div className="relative w-16 h-8 mr-0.5 flex-shrink-0">
                              <Skeleton className="absolute w-8 h-8 rounded-full" style={{ left: 0, top: 0 }} />
                              <Skeleton className="absolute w-8 h-8 rounded-full" style={{ left: 20, top: 0 }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-col min-w-0">
                                <Skeleton className="h-5 w-32 mb-1" />
                                <div className="flex items-center gap-2 min-w-0">
                                  <Skeleton className="h-5 w-16 rounded-md" />
                                  <div className="h-3 w-px bg-border" />
                                  <Skeleton className="h-5 w-5 rounded-md" />
                                  <Skeleton className="h-4 w-12" />
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="w-0 border-l border-dashed border-sidebar-border/60 self-stretch mx-1 flex-shrink-0" />
                      <div className="w-[160px] flex-shrink-0 rounded-lg bg-muted/30 border border-sidebar-border/60 hidden sm:block">
                        <div className="flex items-center px-3 h-9">
                          <span className="text-xs tracking-wider text-muted-foreground font-mono font-bold">TVL</span>
                        </div>
                        <div className="px-3 py-1">
                          <Skeleton className="h-5 w-20" />
                        </div>
                      </div>
                      <div className="w-[160px] flex-shrink-0 rounded-lg bg-muted/30 border border-sidebar-border/60">
                        <div className="flex items-center px-3 h-9">
                          <span className="text-xs tracking-wider text-muted-foreground font-mono font-bold">APY</span>
                        </div>
                        <div className="px-3 py-1">
                          <Skeleton className="h-5 w-16" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-sidebar-border bg-container p-4">
                <Skeleton className="h-[300px] w-full rounded-lg" />
              </div>
              <div className="rounded-xl border border-sidebar-border bg-container p-4">
                <div className="flex items-center justify-between mb-4">
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="h-8 w-8 rounded" />
                </div>
                <div className="space-y-3">
                  {[...Array(2)].map((_, i) => (
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
            </div>
            <div className="w-full min-[1500px]:w-[400px] flex-shrink-0 space-y-4">
              <div className="rounded-xl border border-sidebar-border bg-container p-4 space-y-4">
                <Skeleton className="h-6 w-32" />
                <div className="space-y-3">
                  <div className="rounded-lg border border-sidebar-border p-3">
                    <div className="flex items-center justify-between mb-2">
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="h-4 w-20" />
                    </div>
                    <Skeleton className="h-10 w-full" />
                  </div>
                  <div className="rounded-lg border border-sidebar-border p-3">
                    <div className="flex items-center justify-between mb-2">
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="h-4 w-20" />
                    </div>
                    <Skeleton className="h-10 w-full" />
                  </div>
                  <Skeleton className="h-[200px] w-full rounded-lg" />
                  <Skeleton className="h-12 w-full rounded-lg" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
