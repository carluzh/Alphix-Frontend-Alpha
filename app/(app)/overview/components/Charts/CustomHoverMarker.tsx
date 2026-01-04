"use client";

// Color constant - matches CSS variable
const SURFACE1_COLOR = "hsl(0 0% 7%)"; // --background

// Simple opacity function for hex colors
function opacify(opacity: number, color: string): string {
  // Convert opacity (0-100) to hex alpha (00-FF)
  const alpha = Math.round((opacity / 100) * 255)
    .toString(16)
    .padStart(2, "0");
  // If color is already a hex with 6 chars, append alpha
  if (color.startsWith("#") && color.length === 7) {
    return color + alpha;
  }
  // For other formats, just return with opacity
  return color;
}

interface CustomHoverMarkerProps {
  coordinates: { x: number; y: number };
  lineColor: string;
}

export function CustomHoverMarker({
  coordinates,
  lineColor,
}: CustomHoverMarkerProps) {
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: `${coordinates.x}px`,
        top: `${coordinates.y}px`,
        transform: "translate(-50%, -50%)",
        zIndex: 3,
      }}
    >
      {/* Halo - 16px diameter */}
      <div
        className="absolute rounded-full"
        style={{
          width: "16px",
          height: "16px",
          backgroundColor: opacify(20, lineColor),
          transform: "translate(-50%, -50%)",
        }}
      />
      {/* Main marker - 10px diameter with 2px border */}
      <div
        className="absolute rounded-full border-2"
        style={{
          width: "10px",
          height: "10px",
          backgroundColor: lineColor,
          borderColor: SURFACE1_COLOR,
          transform: "translate(-50%, -50%)",
        }}
      />
    </div>
  );
}
