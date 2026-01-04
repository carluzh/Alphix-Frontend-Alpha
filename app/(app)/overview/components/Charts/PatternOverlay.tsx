"use client";

// Alphix dot pattern overlay
// Positioned to cover only the chart area, not the axes

const DOT_PATTERN = {
  color: "#333333", // Subtle dots
  size: "1px", // Dot size
  spacing: "24px", // Grid spacing (wider than Uniswap's 20px)
};

// Approximate axis dimensions
const TIME_SCALE_HEIGHT = 26; // Height of x-axis labels
const PRICE_SCALE_WIDTH = 55; // Width of y-axis labels (when visible)

interface PatternOverlayProps {
  showPriceScale: boolean;
}

export function PatternOverlay({ showPriceScale }: PatternOverlayProps) {
  // Create dot pattern using radial gradient
  const dotPattern = `radial-gradient(circle, ${DOT_PATTERN.color} ${DOT_PATTERN.size}, transparent ${DOT_PATTERN.size})`;

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        top: 0,
        left: 0,
        right: showPriceScale ? PRICE_SCALE_WIDTH : 0,
        bottom: TIME_SCALE_HEIGHT,
        backgroundImage: dotPattern,
        backgroundSize: `${DOT_PATTERN.spacing} ${DOT_PATTERN.spacing}`,
        backgroundPosition: "0 0",
        zIndex: 0,
      }}
    />
  );
}
