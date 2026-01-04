"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

const DEFAULT_SEARCH_INPUT_WIDTH = 280;
const DEBOUNCE_DELAY_MS = 300;

interface SearchInputProps {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  width?: number | string;
  className?: string;
}

/**
 * SearchInput - matches Uniswap's SearchInput exactly
 *
 * Styling:
 * - backgroundColor="$surface2" → bg-container
 * - borderWidth={1} borderColor="$surface3" → border border-sidebar-border
 * - borderRadius="$rounded12" → rounded-xl
 * - height={40} → h-10
 * - padding="$spacing12" paddingLeft="$spacing40" → p-3 pl-10
 * - placeholderTextColor="$neutral2" → placeholder:text-muted-foreground
 * - fontSize="$body3" → text-sm
 * - fontWeight="500" → font-medium
 * - Focus: backgroundColor="$surface1" color="$neutral1"
 * - Hover: backgroundColor="$surface1Hovered"
 */
export function SearchInput({
  value,
  onChangeText,
  placeholder = "Search",
  width = DEFAULT_SEARCH_INPUT_WIDTH,
  className,
}: SearchInputProps) {
  const [internalValue, setInternalValue] = useState(value);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced callback
  const debouncedOnChangeText = useCallback(
    (newValue: string) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        onChangeText(newValue);
      }, DEBOUNCE_DELAY_MS);
    },
    [onChangeText]
  );

  // Sync internal value with external value prop
  useEffect(() => {
    setInternalValue(value);
  }, [value]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInternalValue(newValue);
    debouncedOnChangeText(newValue);
  };

  return (
    <div
      className={cn("relative", className)}
      style={{ width: typeof width === "number" ? `${width}px` : width }}
    >
      <input
        type="text"
        placeholder={placeholder}
        value={internalValue}
        onChange={handleChange}
        className={cn(
          // Base styling
          "w-full h-10 pl-10 pr-3 py-3",
          // Typography
          "text-sm font-medium",
          // Colors
          "bg-container text-muted-foreground placeholder:text-muted-foreground",
          // Border
          "border border-sidebar-border rounded-xl",
          // Focus state
          "focus:outline-none focus:bg-background focus:text-foreground focus:border-sidebar-border",
          // Hover state
          "hover:bg-surface/50",
          // Transition
          "transition-colors"
        )}
      />
      {/* Search icon */}
      <div className="absolute left-3 top-0 bottom-0 flex items-center justify-center pointer-events-none">
        <Search className="h-5 w-5 text-foreground" />
      </div>
    </div>
  );
}

export default SearchInput;
