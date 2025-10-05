"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { TokenSymbol } from "@/lib/pools-config";

interface RangeSelectionModalProps {
  // Modal control
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (tickLower: string, tickUpper: string) => void;

  // Initial values
  initialTickLower: string;
  initialTickUpper: string;

  // Pool info
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
  currentPrice: string | null;
  currentPoolTick: number | null;

  // Display values
  minPriceDisplay: string;
  maxPriceDisplay: string;
  baseTokenSymbol: TokenSymbol;

  // Constraints
  sdkMinTick: number;
  sdkMaxTick: number;
  defaultTickSpacing: number;

  // Presets
  presetOptions: string[];
}

export function RangeSelectionModal({
  isOpen,
  onClose,
  onConfirm,
  initialTickLower,
  initialTickUpper,
  token0Symbol,
  token1Symbol,
  currentPrice,
  currentPoolTick,
  minPriceDisplay,
  maxPriceDisplay,
  baseTokenSymbol,
  sdkMinTick,
  sdkMaxTick,
  defaultTickSpacing,
  presetOptions,
}: RangeSelectionModalProps) {
  // Local state for editing (don't modify parent until confirmed)
  const [localTickLower, setLocalTickLower] = useState(initialTickLower);
  const [localTickUpper, setLocalTickUpper] = useState(initialTickUpper);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);

  // Reset local state when modal opens with new values
  useEffect(() => {
    if (isOpen) {
      setLocalTickLower(initialTickLower);
      setLocalTickUpper(initialTickUpper);
      setSelectedPreset(null);
    }
  }, [isOpen, initialTickLower, initialTickUpper]);

  const handlePresetClick = (preset: string) => {
    setSelectedPreset(preset);

    if (preset === "Full Range") {
      setLocalTickLower(sdkMinTick.toString());
      setLocalTickUpper(sdkMaxTick.toString());
      return;
    }

    // Handle percentage presets
    if (currentPoolTick === null) {
      console.warn("Cannot apply preset: currentPoolTick is null");
      return;
    }

    // Map preset to percentage
    const percentageMap: Record<string, number> = {
      "±15%": 0.15,
      "±8%": 0.08,
      "±3%": 0.03,
      "±1%": 0.01,
      "±0.5%": 0.005,
      "±0.1%": 0.001,
    };

    const percentage = percentageMap[preset];
    if (!percentage) {
      console.warn(`Unknown preset: ${preset}`);
      return;
    }

    // Calculate tick delta from percentage
    const tickDelta = Math.round(Math.log(1 + percentage) / Math.log(1.0001));

    // Calculate new ticks centered around current pool tick
    let newTickLower = currentPoolTick - tickDelta;
    let newTickUpper = currentPoolTick + tickDelta;

    // Round to tick spacing
    newTickLower = Math.floor(newTickLower / defaultTickSpacing) * defaultTickSpacing;
    newTickUpper = Math.ceil(newTickUpper / defaultTickSpacing) * defaultTickSpacing;

    // Constrain to min/max
    newTickLower = Math.max(sdkMinTick, newTickLower);
    newTickUpper = Math.min(sdkMaxTick, newTickUpper);

    setLocalTickLower(newTickLower.toString());
    setLocalTickUpper(newTickUpper.toString());
  };

  const handleConfirm = () => {
    onConfirm(localTickLower, localTickUpper);
    onClose();
  };

  const handleCancel = () => {
    // Reset to initial values
    setLocalTickLower(initialTickLower);
    setLocalTickUpper(initialTickUpper);
    setSelectedPreset(null);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            Select Price Range
          </DialogTitle>
          <DialogDescription>
            Choose a preset range or manually adjust your liquidity position for {token0Symbol}/{token1Symbol}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Current Price Display */}
          {currentPrice && (
            <div className="bg-accent/50 rounded-lg p-4 text-center">
              <div className="text-sm text-muted-foreground mb-1">Current Market Price</div>
              <div className="text-2xl font-bold">{currentPrice}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {token1Symbol} per {token0Symbol}
              </div>
            </div>
          )}

          {/* Preset Buttons */}
          <div>
            <div className="text-sm font-medium mb-3">Quick Presets</div>
            <div className="flex flex-wrap gap-2">
              {presetOptions.map((preset) => (
                <Button
                  key={preset}
                  variant={selectedPreset === preset ? "default" : "outline"}
                  size="sm"
                  onClick={() => handlePresetClick(preset)}
                  className="min-w-[80px]"
                >
                  {preset}
                </Button>
              ))}
            </div>
          </div>

          {/* Current Range Display */}
          <div className="grid grid-cols-2 gap-4 p-4 border rounded-lg bg-card">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Min Price</div>
              <div className="text-lg font-semibold">{minPriceDisplay}</div>
              <div className="text-xs text-muted-foreground mt-1">{baseTokenSymbol}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground mb-1">Max Price</div>
              <div className="text-lg font-semibold">{maxPriceDisplay}</div>
              <div className="text-xs text-muted-foreground mt-1">{baseTokenSymbol}</div>
            </div>
          </div>

          {/* Info Text */}
          <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">
            <p>
              💡 <strong>Tip:</strong> Select a preset range or use the inputs below (coming in next step)
              to customize your liquidity concentration.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>
            Confirm Range
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
