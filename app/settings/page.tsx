"use client";

import { AppLayout } from "@/components/app-layout";
import { useState, useMemo, useRef, useEffect } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { BadgeCheck, AlertTriangle, Loader2 } from "lucide-react";
import { Section, SectionDescription } from "@/components/settings/Section";
import { SettingsGroup, SettingsGroupItem } from "@/components/settings/SettingsGroup";
import { cn } from "@/lib/utils";
import { useNetwork } from "@/lib/network-context";
import { useUserSettings, type ApprovalMode } from "@/hooks/useUserSettings";

export default function SettingsPage() {
  // Network settings - connected to global context
  const { isTestnet, setNetworkMode } = useNetwork();
  const [testnetMode, setTestnetMode] = useState(isTestnet);
  const [isNetworkSwitching, setIsNetworkSwitching] = useState(false);

  // User settings hook with persistence
  const {
    settings,
    isLoaded,
    setSlippage,
    setDeadline,
    setApprovalMode: updateApprovalMode,
  } = useUserSettings();

  // Local state for form inputs (synced with persisted settings)
  const [slippageTolerance, setSlippageTolerance] = useState("0.5");
  const [customSlippage, setCustomSlippage] = useState("");
  const [transactionDeadline, setTransactionDeadline] = useState("30");
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("exact");

  // Sync local state with loaded settings
  useEffect(() => {
    if (isLoaded) {
      const slipStr = settings.slippage.toString();
      if (settings.customSlippage) {
        setCustomSlippage(settings.customSlippage);
        setSlippageTolerance(settings.customSlippage);
      } else if (["0.1", "0.5", "1.0"].includes(slipStr)) {
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

  // Sync local state with context
  useEffect(() => {
    setTestnetMode(isTestnet);
  }, [isTestnet]);

  // Handle network toggle
  const handleNetworkToggle = (newTestnetMode: boolean) => {
    if (isNetworkSwitching) return;
    setTestnetMode(newTestnetMode);
    setIsNetworkSwitching(true);
    toast.info("Switching network...", {
      icon: <Loader2 className="h-4 w-4 animate-spin" />,
    });
    // Small delay for UX feedback before page reload
    setTimeout(() => {
      setNetworkMode(newTestnetMode ? 'testnet' : 'mainnet');
    }, 500);
  };

  // Refs for measuring button positions
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const customRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [highlightStyle, setHighlightStyle] = useState({ left: 0, width: 0 });

  const presetValues = ["0.1", "0.5", "1.0"];
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
        const selectedIndex = presetValues.indexOf(slippageTolerance);
        if (selectedIndex !== -1 && buttonRefs.current[selectedIndex] && containerRef.current) {
          const containerRect = containerRef.current.getBoundingClientRect();
          const buttonRect = buttonRefs.current[selectedIndex]!.getBoundingClientRect();
          setHighlightStyle({
            left: buttonRect.left - containerRect.left,
            width: buttonRect.width,
          });
        }
      }
    };

    updateHighlight();
  }, [slippageTolerance, customSlippage, isCustom]);

  // Check if there are unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    if (!isLoaded) return false;
    const currentSlippage = parseFloat(customSlippage || slippageTolerance);
    const currentDeadline = parseInt(transactionDeadline, 10);
    return (
      currentSlippage !== settings.slippage ||
      currentDeadline !== settings.deadline ||
      approvalMode !== settings.approvalMode
    );
  }, [slippageTolerance, customSlippage, transactionDeadline, approvalMode, settings, isLoaded]);

  const handleApplyChanges = () => {
    const newSlippage = parseFloat(customSlippage || slippageTolerance);
    const newDeadline = parseInt(transactionDeadline, 10);

    // Validate
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

    // Save settings
    setSlippage(newSlippage, customSlippage || undefined);
    setDeadline(newDeadline);
    updateApprovalMode(approvalMode);

    toast.info("Settings Changed");
  };

  // Handle slippage preset click - don't save, just update local state
  const handleSlippagePresetClick = (value: string) => {
    setSlippageTolerance(value);
    setCustomSlippage("");
  };

  // Handle approval mode change - just update local state
  const handleApprovalModeChange = (value: string) => {
    setApprovalMode(value as ApprovalMode);
  };

  // Determine if we have a valid selection to show highlight
  const showHighlight = isCustom || presetValues.includes(slippageTolerance);

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col font-sans">
        <div className="relative flex min-w-0 flex-1 flex-col items-center px-4 md:px-8">
          <div className="flex h-full w-full max-w-xl flex-col">
            {/* Settings Sections */}
            <div className="flex flex-col gap-y-8 py-8">
              {/* Network Settings */}
              <Section id="network">
                <SectionDescription title="Network" />
                <SettingsGroup>
                  <div
                    onClick={() => !isNetworkSwitching && handleNetworkToggle(!testnetMode)}
                    className={cn(
                      "cursor-pointer hover:bg-muted/20 transition-colors p-4",
                      isNetworkSwitching && "opacity-50 pointer-events-none"
                    )}
                  >
                    <div className="flex gap-x-8 gap-y-3 flex-col md:flex-row md:items-center md:justify-between">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium">Testnet Mode</h3>
                      </div>
                      <div className="flex items-center md:w-auto md:justify-end">
                        {isNetworkSwitching ? (
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        ) : (
                          <Checkbox
                            checked={testnetMode}
                            disabled={isNetworkSwitching}
                            onCheckedChange={(checked) => handleNetworkToggle(checked === true)}
                            className="h-5 w-5 border-sidebar-border data-[state=checked]:bg-sidebar-primary data-[state=checked]:border-sidebar-primary"
                          />
                        )}
                      </div>
                    </div>
                    {!testnetMode && (
                      <div className="flex items-center gap-2 mt-4 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                        <AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0" />
                        <span className="text-xs text-yellow-500">
                          Mainnet uses real assets. Contracts are currently being audited.
                        </span>
                      </div>
                    )}
                  </div>
                </SettingsGroup>
              </Section>

              {/* Trading Settings */}
              <Section id="trading">
                <SectionDescription title="Trading" />
                <SettingsGroup>
                  <SettingsGroupItem
                    title="Slippage Tolerance"
                    description="Maximum price change before your transaction reverts"
                  >
                    {/* Unified pill with animated highlight */}
                    <div
                      ref={containerRef}
                      className="relative flex items-center h-9 rounded-lg border border-sidebar-border bg-surface"
                    >
                      {/* Animated highlight */}
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
                        {presetValues.map((value, index) => (
                          <button
                            key={value}
                            ref={(el) => { buttonRefs.current[index] = el; }}
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
                      {/* Vertical divider */}
                      <div className="h-5 w-px bg-sidebar-border relative z-10" />
                      {/* Custom input */}
                      <div ref={customRef} className="relative z-10 flex items-center justify-between h-7 w-[72px] mx-1 px-2 rounded-md">
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
                          className={`h-7 w-[50px] bg-transparent border-none text-sm text-left focus:outline-none placeholder:text-muted-foreground/60 ${isCustom ? "text-sidebar-primary" : "text-foreground"}`}
                        />
                        {isCustom && (
                          <span className="text-sm text-sidebar-primary">%</span>
                        )}
                      </div>
                    </div>
                  </SettingsGroupItem>

                  <SettingsGroupItem
                    title="Transaction Deadline"
                    description="How long before a pending transaction reverts"
                  >
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        value={transactionDeadline}
                        onChange={(e) => setTransactionDeadline(e.target.value)}
                        className="h-9 w-[72px] bg-surface border-sidebar-border text-sm text-center"
                      />
                      <span className="text-sm text-muted-foreground">minutes</span>
                    </div>
                  </SettingsGroupItem>

                  <SettingsGroupItem
                    title="Token Approval"
                    description={
                      approvalMode === "exact"
                        ? "Approve only the exact amount needed for each swap"
                        : "Approve unlimited spending to save gas on future swaps"
                    }
                  >
                    <Select value={approvalMode} onValueChange={handleApprovalModeChange}>
                      <SelectTrigger className="w-[100px] h-9 bg-surface border-sidebar-border text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-selector border-sidebar-border">
                        <SelectItem value="exact">Exact</SelectItem>
                        <SelectItem value="infinite">Infinite</SelectItem>
                      </SelectContent>
                    </Select>
                  </SettingsGroupItem>
                </SettingsGroup>
              </Section>

              {/* Apply Changes Button - only show for custom slippage/deadline changes */}
              {hasUnsavedChanges && (
                <div className="flex justify-end -mt-4">
                  <Button
                    onClick={handleApplyChanges}
                    className="bg-button-primary border border-sidebar-primary text-sidebar-primary hover-button-primary px-6"
                  >
                    Apply Changes
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
