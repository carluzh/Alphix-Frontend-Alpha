"use client";

/**
 * SettingsPopover - Sliding settings panel for Portfolio page
 *
 * Based on Uniswap's SettingsMenu pattern and Alphix Settings page structure.
 * Uses section titles (Network, Trading) with compact item rows.
 */

import { memo, useState, useCallback, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { IconGear } from "nucleo-micro-bold-essential";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useUserSettings, type ApprovalMode } from "@/hooks/useUserSettings";
import { useNetwork, MAINNET_CHAIN_ID, TESTNET_CHAIN_ID } from "@/lib/network-context";
import { useAccount } from "wagmi";
import { switchChain } from "@wagmi/core";
import { config } from "@/lib/wagmiConfig";

export enum SettingsView {
  MAIN = "main",
}

interface SettingsPopoverProps {
  size?: number;
  className?: string;
}

const SLIPPAGE_PRESETS = ["0.1", "0.5", "1.0"];

/**
 * Section title component
 */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
      {children}
    </span>
  );
}

/**
 * Settings row with label and control
 */
function SettingsRow({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-foreground">{title}</span>
      {children}
    </div>
  );
}

/**
 * SettingsPanel - The actual sliding panel content
 */
function SettingsPanel({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  // Network settings
  const { isTestnet, setNetworkMode } = useNetwork();
  const { isConnected } = useAccount();
  const [testnetMode, setTestnetMode] = useState(isTestnet);
  const [isNetworkSwitching, setIsNetworkSwitching] = useState(false);

  // User settings
  const {
    settings,
    isLoaded,
    setSlippage,
    setDeadline,
    setApprovalMode: updateApprovalMode,
  } = useUserSettings();

  // Local state for form inputs
  const [slippageTolerance, setSlippageTolerance] = useState("0.5");
  const [customSlippage, setCustomSlippage] = useState("");
  const [transactionDeadline, setTransactionDeadline] = useState("30");
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("exact");

  // Sync testnet mode with context
  useEffect(() => {
    setTestnetMode(isTestnet);
  }, [isTestnet]);

  // Sync local state with loaded settings
  useEffect(() => {
    if (isLoaded) {
      const slipStr = settings.slippage.toString();
      if (settings.customSlippage) {
        setCustomSlippage(settings.customSlippage);
        setSlippageTolerance(settings.customSlippage);
      } else if (SLIPPAGE_PRESETS.includes(slipStr)) {
        setSlippageTolerance(slipStr);
        setCustomSlippage("");
      } else {
        setCustomSlippage(slipStr);
        setSlippageTolerance(slipStr);
      }
      setTransactionDeadline(settings.deadline.toString());
      setApprovalMode(settings.approvalMode);
    }
  }, [isLoaded, settings]);

  // Handle network toggle - runs in background, doesn't close panel
  const handleNetworkToggle = useCallback(async () => {
    if (isNetworkSwitching) return;

    const newTestnetMode = !testnetMode;
    setTestnetMode(newTestnetMode);
    setIsNetworkSwitching(true);

    const targetChainId = newTestnetMode ? TESTNET_CHAIN_ID : MAINNET_CHAIN_ID;

    if (isConnected) {
      try {
        await switchChain(config, { chainId: targetChainId });
      } catch (error: unknown) {
        console.log("[Settings] Chain switch failed:", (error as Error)?.message);
      }
    }

    // Update network mode in background
    setTimeout(() => {
      setNetworkMode(newTestnetMode ? "testnet" : "mainnet");
      setIsNetworkSwitching(false);
    }, 300);
  }, [testnetMode, isNetworkSwitching, isConnected, setNetworkMode]);

  // Slippage highlight refs
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const customRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [highlightStyle, setHighlightStyle] = useState({ left: 0, width: 0 });

  const isCustom = customSlippage !== "";

  // Update highlight position
  useEffect(() => {
    const updateHighlight = () => {
      if (isCustom && customRef.current && containerRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect();
        const customRect = customRef.current.getBoundingClientRect();
        setHighlightStyle({
          left: customRect.left - containerRect.left,
          width: customRect.width,
        });
      } else {
        const selectedIndex = SLIPPAGE_PRESETS.indexOf(slippageTolerance);
        if (
          selectedIndex !== -1 &&
          buttonRefs.current[selectedIndex] &&
          containerRef.current
        ) {
          const containerRect = containerRef.current.getBoundingClientRect();
          const buttonRect =
            buttonRefs.current[selectedIndex]!.getBoundingClientRect();
          setHighlightStyle({
            left: buttonRect.left - containerRect.left,
            width: buttonRect.width,
          });
        }
      }
    };

    const timer = setTimeout(updateHighlight, 50);
    return () => clearTimeout(timer);
  }, [slippageTolerance, customSlippage, isCustom, isOpen]);

  // Check for unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    if (!isLoaded) return false;
    const currentSlippage = parseFloat(customSlippage || slippageTolerance);
    const currentDeadline = parseInt(transactionDeadline, 10);
    return (
      currentSlippage !== settings.slippage ||
      currentDeadline !== settings.deadline ||
      approvalMode !== settings.approvalMode
    );
  }, [
    slippageTolerance,
    customSlippage,
    transactionDeadline,
    approvalMode,
    settings,
    isLoaded,
  ]);

  // Handle applying changes
  const handleApplyChanges = useCallback(() => {
    const newSlippage = parseFloat(customSlippage || slippageTolerance);
    const newDeadline = parseInt(transactionDeadline, 10);

    if (isNaN(newSlippage) || newSlippage <= 0 || newSlippage > 50) {
      toast.error("Invalid slippage", {
        description: "Slippage must be between 0.01% and 50%",
      });
      return;
    }
    if (isNaN(newDeadline) || newDeadline < 1 || newDeadline > 60) {
      toast.error("Invalid deadline", {
        description: "Deadline must be between 1 and 60 minutes",
      });
      return;
    }

    setSlippage(newSlippage, customSlippage || undefined);
    setDeadline(newDeadline);
    updateApprovalMode(approvalMode);

    toast.info("Settings saved");
  }, [
    customSlippage,
    slippageTolerance,
    transactionDeadline,
    approvalMode,
    setSlippage,
    setDeadline,
    updateApprovalMode,
  ]);

  const handleSlippagePresetClick = useCallback((value: string) => {
    setSlippageTolerance(value);
    setCustomSlippage("");
  }, []);

  const handleApprovalModeChange = useCallback((value: string) => {
    setApprovalMode(value as ApprovalMode);
  }, []);

  // Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const showHighlight = isCustom || SLIPPAGE_PRESETS.includes(slippageTolerance);

  return (
    <div
      className={cn(
        "fixed z-50",
        "top-5 right-5 bottom-5",
        "w-[390px]",
        "bg-container border border-sidebar-border/60 rounded-lg",
        "shadow-xl",
        "flex flex-col",
        // Fast slide + delayed opacity fade
        "transition-all duration-150 ease-out",
        isOpen
          ? "translate-x-0 opacity-100"
          : "translate-x-[80px] opacity-0 pointer-events-none"
      )}
      style={{
        transitionProperty: "transform, opacity",
        transitionDuration: "150ms, 100ms",
        transitionDelay: isOpen ? "0ms, 50ms" : "0ms, 0ms",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-sidebar-border/60 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="p-1 hover:opacity-60 transition-opacity"
          >
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </button>
          <span className="text-base font-medium text-foreground">
            Settings
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:opacity-60 transition-opacity"
        >
          <X className="h-5 w-5 text-muted-foreground" />
        </button>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-6">
          {/* Network Section */}
          <div className="flex flex-col gap-2">
            <SectionTitle>Network</SectionTitle>
            <SettingsRow title="Testnet mode">
              <Switch
                checked={testnetMode}
                onCheckedChange={handleNetworkToggle}
                disabled={isNetworkSwitching}
              />
            </SettingsRow>
          </div>

          {/* Trading Section */}
          <div className="flex flex-col gap-2">
            <SectionTitle>Trading</SectionTitle>

            {/* Slippage Tolerance */}
            <div className="flex flex-col gap-2 py-2">
              <span className="text-sm text-foreground">Slippage tolerance</span>
              <div
                ref={containerRef}
                className="relative inline-flex items-center h-9 rounded-lg border border-sidebar-border/60 bg-background w-fit"
              >
                {showHighlight && (
                  <div
                    className="absolute h-7 bg-button-primary rounded-md transition-all duration-200 ease-out"
                    style={{
                      left: highlightStyle.left,
                      width: highlightStyle.width,
                    }}
                  />
                )}
                <div className="flex items-center px-1 relative z-10">
                  {SLIPPAGE_PRESETS.map((value, index) => (
                    <button
                      key={value}
                      ref={(el) => {
                        buttonRefs.current[index] = el;
                      }}
                      onClick={() => handleSlippagePresetClick(value)}
                      className={cn(
                        "px-3 h-7 text-sm rounded-md transition-colors",
                        slippageTolerance === value && !isCustom
                          ? "text-sidebar-primary"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {value}%
                    </button>
                  ))}
                </div>
                <div className="h-5 w-px bg-sidebar-border relative z-10" />
                <div
                  ref={customRef}
                  className="relative z-10 flex items-center h-7 w-[72px] mx-1 px-2 rounded-md"
                >
                  <input
                    type="number"
                    placeholder="Custom"
                    value={customSlippage}
                    onChange={(e) => {
                      setCustomSlippage(e.target.value);
                      if (e.target.value) {
                        setSlippageTolerance(e.target.value);
                      }
                    }}
                    className={cn(
                      "h-7 w-[50px] bg-transparent border-none text-sm text-left focus:outline-none placeholder:text-muted-foreground/60",
                      isCustom ? "text-sidebar-primary" : "text-foreground"
                    )}
                  />
                  {isCustom && (
                    <span className="text-sm text-sidebar-primary">%</span>
                  )}
                </div>
              </div>
            </div>

            {/* Transaction Deadline */}
            <SettingsRow title="Deadline">
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  value={transactionDeadline}
                  onChange={(e) => setTransactionDeadline(e.target.value)}
                  className="h-8 w-[56px] bg-background border-sidebar-border/60 text-sm text-center"
                />
                <span className="text-sm text-muted-foreground">min</span>
              </div>
            </SettingsRow>

            {/* Token Approval */}
            <SettingsRow title="Approval">
              <Select value={approvalMode} onValueChange={handleApprovalModeChange}>
                <SelectTrigger className="w-[90px] h-8 bg-background border-sidebar-border/60 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-background border-sidebar-border/60">
                  <SelectItem value="exact">Exact</SelectItem>
                  <SelectItem value="infinite">Infinite</SelectItem>
                </SelectContent>
              </Select>
            </SettingsRow>
          </div>
        </div>
      </div>

      {/* Footer - Apply Changes (sticky at bottom) */}
      {hasUnsavedChanges && (
        <div className="flex-shrink-0 px-4 py-3 border-t border-sidebar-border/60">
          <Button
            onClick={handleApplyChanges}
            className="w-full bg-button-primary border border-sidebar-primary text-sidebar-primary hover-button-primary"
          >
            Apply Changes
          </Button>
        </div>
      )}
    </div>
  );
}

export const SettingsPopover = memo(function SettingsPopover({
  size = 24,
  className,
}: SettingsPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  return (
    <>
      <button
        onClick={handleToggle}
        className={cn(
          "flex items-center justify-center",
          "rounded-full",
          "transition-colors duration-200",
          "hover:bg-muted",
          "p-1.5",
          isOpen && "bg-muted",
          className
        )}
        aria-label="Settings"
      >
        <IconGear
          width={size}
          height={size}
          className="text-muted-foreground"
        />
      </button>

      {mounted &&
        createPortal(
          <SettingsPanel isOpen={isOpen} onClose={handleClose} />,
          document.body
        )}
    </>
  );
});

export default SettingsPopover;
