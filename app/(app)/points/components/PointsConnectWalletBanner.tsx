"use client";

import { AnimatedEmblems } from "@/app/(app)/overview/components/ConnectWalletBanner/AnimatedStyledBanner/AnimatedEmblems";
import { appKit } from "@/components/AppKitProvider";

/**
 * PointsConnectWalletBanner - Shows connect wallet CTA on Points page
 * Displayed instead of PointsInventoryCard when wallet is not connected
 *
 * Uses h-full to stretch and match the height of the adjacent stats panel
 */
export function PointsConnectWalletBanner() {
  const handleConnect = () => {
    appKit?.open();
  };

  return (
    <div className="relative overflow-hidden bg-muted/30 border border-sidebar-border/60 rounded-lg h-full min-h-[216px]">
      {/* Grid pattern overlay */}
      <div
        className="absolute inset-0 bg-center bg-repeat opacity-60"
        style={{
          backgroundImage: "url(/patterns/button-default.svg)",
          backgroundSize: "auto",
        }}
      />
      <AnimatedEmblems />
      <div className="relative w-full h-full z-10 flex flex-col items-center justify-center gap-4">
        <span className="text-sm font-medium text-foreground">
          Connect a wallet <span className="text-muted-foreground">to view your points</span>
        </span>
        <button
          type="button"
          onClick={handleConnect}
          className="flex h-10 cursor-pointer items-center justify-center rounded-md bg-button-primary text-sidebar-primary border border-sidebar-primary px-8 font-semibold transition-all hover-button-primary"
        >
          Connect
        </button>
      </div>
    </div>
  );
}

export default PointsConnectWalletBanner;
