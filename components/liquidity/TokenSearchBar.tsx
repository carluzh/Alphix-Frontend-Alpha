"use client";

import { useState, useEffect, useMemo, useCallback, useRef, memo } from "react";
import Image from "next/image";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAllTokens, type TokenConfig } from "@/lib/pools-config";
import { useNetwork } from "@/lib/network-context";

interface TokenSearchBarProps {
  /** Current search value */
  value: string;
  /** Called when search value changes (debounced) */
  onValueChange: (value: string) => void;
  /** Called when a token is selected from dropdown */
  onTokenSelect?: (token: TokenConfig) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Additional class names */
  className?: string;
}

/**
 * TokenSearchBar - Search input with token autocomplete
 *
 * Static width search bar with Alphix branding:
 * - Fixed width (no dynamic expanding)
 * - Search icon left, X button right
 * - 300ms debounce
 * - Token autocomplete dropdown with icons
 */
export const TokenSearchBar = memo(function TokenSearchBar({
  value,
  onValueChange,
  onTokenSelect,
  placeholder = "Search tokens...",
  className,
}: TokenSearchBarProps) {
  const { networkMode } = useNetwork();
  const [localValue, setLocalValue] = useState(value);
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Get all tokens for autocomplete
  const allTokens = useMemo(() => {
    const tokens = getAllTokens(networkMode);
    return Object.values(tokens);
  }, [networkMode]);

  // Filter tokens based on search input
  const filteredTokens = useMemo(() => {
    if (!localValue.trim()) return allTokens;
    const searchLower = localValue.toLowerCase().trim();
    return allTokens.filter(
      (token) =>
        token.symbol.toLowerCase().includes(searchLower) ||
        token.name.toLowerCase().includes(searchLower)
    );
  }, [localValue, allTokens]);

  // Sync external value
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  // Debounce value changes (300ms like Uniswap)
  useEffect(() => {
    const timer = setTimeout(() => {
      onValueChange(localValue);
    }, 300);
    return () => clearTimeout(timer);
  }, [localValue, onValueChange]);

  // Handle outside clicks to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleFocus = useCallback(() => {
    setShowDropdown(true);
  }, []);

  const handleBlur = useCallback(() => {
    // Delay to allow click on dropdown items
    setTimeout(() => {
      setShowDropdown(false);
    }, 150);
  }, []);

  const handleClear = useCallback(() => {
    setLocalValue("");
    onValueChange("");
    setShowDropdown(false);
    inputRef.current?.blur();
  }, [onValueChange]);

  const handleTokenClick = useCallback(
    (token: TokenConfig) => {
      setLocalValue(token.symbol);
      onValueChange(token.symbol);
      setShowDropdown(false);
      onTokenSelect?.(token);
    },
    [onValueChange, onTokenSelect]
  );

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
    setShowDropdown(true);
  }, []);

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {/* Search Input - fixed width with Alphix styling */}
      <div className="relative flex items-center h-10 w-[220px]">
        {/* Search Icon */}
        <div className="absolute left-3 flex items-center justify-center pointer-events-none z-10">
          <Search className="h-4 w-4 text-muted-foreground" />
        </div>

        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          value={localValue}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
          className={cn(
            "h-full w-full rounded-lg border border-sidebar-border bg-muted/30 text-sm text-foreground font-sans",
            "pl-9 pr-8",
            "placeholder:text-muted-foreground/60",
            "transition-colors duration-150",
            "focus:outline-none focus:border-sidebar-border",
            "hover:bg-muted/50"
          )}
          autoComplete="off"
        />

        {/* Clear Button */}
        {localValue && (
          <button
            onClick={handleClear}
            className="absolute right-2 p-1 rounded hover:bg-muted/60 transition-colors"
            type="button"
          >
            <IconXmark className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}
      </div>

      {/* Dropdown */}
      {showDropdown && filteredTokens.length > 0 && (
        <div
          className={cn(
            "absolute top-full mt-1.5 right-0 w-[240px] max-h-[280px] overflow-y-auto z-50",
            "rounded-lg border border-sidebar-border bg-container",
            "shadow-lg animate-in fade-in-0 zoom-in-95 duration-150"
          )}
        >
          <div className="p-1">
            {filteredTokens.map((token) => (
              <TokenDropdownItem
                key={token.symbol}
                token={token}
                isSelected={localValue.toLowerCase() === token.symbol.toLowerCase()}
                onClick={() => handleTokenClick(token)}
              />
            ))}
          </div>
        </div>
      )}

      {/* No results */}
      {showDropdown && localValue && filteredTokens.length === 0 && (
        <div
          className={cn(
            "absolute top-full mt-1.5 right-0 w-[240px] z-50",
            "rounded-lg border border-sidebar-border bg-container",
            "shadow-lg animate-in fade-in-0 zoom-in-95 duration-150"
          )}
        >
          <div className="p-4 text-center text-sm text-muted-foreground font-sans">
            No tokens found
          </div>
        </div>
      )}
    </div>
  );
});

interface TokenDropdownItemProps {
  token: TokenConfig;
  isSelected: boolean;
  onClick: () => void;
}

const TokenDropdownItem = memo(function TokenDropdownItem({
  token,
  isSelected,
  onClick,
}: TokenDropdownItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded",
        "transition-colors duration-75",
        isSelected
          ? "bg-muted/60 text-foreground"
          : "hover:bg-muted/40 text-foreground"
      )}
      type="button"
    >
      {/* Token Icon */}
      <div className="w-8 h-8 rounded-full overflow-hidden bg-muted flex-shrink-0 border border-sidebar-border/50">
        {token.icon ? (
          <Image
            src={token.icon}
            alt={token.symbol}
            width={32}
            height={32}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs font-medium font-sans">
            {token.symbol.slice(0, 2)}
          </div>
        )}
      </div>

      {/* Token Info */}
      <div className="flex-1 min-w-0 text-left">
        <div className="text-sm font-medium font-sans truncate">{token.symbol}</div>
        <div className="text-xs text-muted-foreground font-sans truncate">{token.name}</div>
      </div>

      {/* Selected indicator - neutral style, no brand orange */}
      {isSelected && (
        <div className="w-1.5 h-1.5 rounded-full bg-foreground/40 flex-shrink-0" />
      )}
    </button>
  );
});

export default TokenSearchBar;
