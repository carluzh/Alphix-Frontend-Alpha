"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { Loader2 } from "lucide-react";

export default function HomePage() {
  const router = useRouter();
  const { isConnected } = useAccount();

  // Route immediately based on isConnected. If wagmi is still "connecting"
  // on mount we get isConnected=false → /liquidity; if a connection settles
  // later this effect re-runs (deps include isConnected) and replaces to
  // /overview. The previous status-aware setup could trap us on this page
  // when status oscillated between "connecting" and "reconnecting" (the
  // 3s safety timeout kept getting torn down before it could fire).
  useEffect(() => {
    router.replace(isConnected ? "/overview" : "/liquidity");
  }, [isConnected, router]);

  return (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}
