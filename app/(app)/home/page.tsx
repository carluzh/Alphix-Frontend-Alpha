"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { Loader2 } from "lucide-react";

export default function HomePage() {
  const router = useRouter();
  const { isConnected, status } = useAccount();

  useEffect(() => {
    if (status === "connecting" || status === "reconnecting") return;
    router.replace(isConnected ? "/overview" : "/liquidity");
  }, [isConnected, status, router]);

  // Fallback: if wagmi is stuck reconnecting for 3s, default to /liquidity
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (status === "connecting" || status === "reconnecting") {
        router.replace("/liquidity");
      }
    }, 3000);
    return () => clearTimeout(timeout);
  }, [status, router]);

  return (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}
