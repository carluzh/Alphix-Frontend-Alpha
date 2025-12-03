import { Skeleton } from "@/components/ui/skeleton"
import { AppLayout } from "@/components/app-layout"

export default function SwapLoading() {
  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
      <div className="flex flex-1 justify-center py-10 md:py-16">
        <div className="w-full max-w-2xl px-4">
          <div className="rounded-xl border border-sidebar-border bg-container p-6 space-y-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-7 w-16" />
              <Skeleton className="h-8 w-8 rounded-full" />
            </div>
            <div className="rounded-lg border border-sidebar-border bg-background p-4 space-y-2">
              <div className="flex items-center justify-between">
                <Skeleton className="h-10 w-32" />
                <Skeleton className="h-10 w-28 rounded-full" />
              </div>
              <Skeleton className="h-4 w-20" />
            </div>
            <div className="flex justify-center -my-2">
              <Skeleton className="h-10 w-10 rounded-full" />
            </div>
            <div className="rounded-lg border border-sidebar-border bg-background p-4 space-y-2">
              <div className="flex items-center justify-between">
                <Skeleton className="h-10 w-32" />
                <Skeleton className="h-10 w-28 rounded-full" />
              </div>
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        </div>
      </div>
      </div>
    </AppLayout>
  )
}
