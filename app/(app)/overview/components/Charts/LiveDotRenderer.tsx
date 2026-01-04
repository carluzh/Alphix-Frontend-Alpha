"use client";

import { useEffect, useState } from "react";

// Color constant - matches CSS variable
const SURFACE1_COLOR = "hsl(0 0% 7%)"; // --background

export interface ChartModelWithLiveDot {
  getLastPointCoordinates?: () => { x: number; y: number } | null;
  fitContent?: () => void;
}

interface LiveDotRendererProps {
  chartModel: ChartModelWithLiveDot;
  isHovering: boolean;
  chartContainer?: HTMLElement | null;
  overrideColor?: string;
  dataKey?: string | number; // Tracks when chart data changes (e.g., time period change)
}

export function LiveDotRenderer({
  chartModel,
  isHovering,
  chartContainer,
  overrideColor,
  dataKey,
}: LiveDotRendererProps) {
  const [coordinates, setCoordinates] = useState<{ x: number; y: number } | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    // Only render if the chart model has getLastPointCoordinates method
    if (!("getLastPointCoordinates" in chartModel) || !dataKey) {
      return undefined;
    }

    const updateCoordinates = () => {
      const coords = chartModel.getLastPointCoordinates?.();
      // Update coordinates when data changes (dataKey triggers this effect)
      setCoordinates(coords ?? null);
    };

    // Try immediately
    updateCoordinates();

    // Listen to chart container resize events
    let resizeObserver: ResizeObserver | null = null;
    let rafId: number | null = null;

    if (chartContainer) {
      resizeObserver = new ResizeObserver(() => {
        // Cancel pending RAF to prevent multiple chains
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
        }

        // Hide dot when resize starts
        setIsResizing(true);

        // Use multiple requestAnimationFrame calls to ensure chart has fully re-laid out,
        // including axis labels which can change the available chart area
        rafId = requestAnimationFrame(() => {
          // Refit chart content to prevent overflow on resize
          // This needs to happen after axis labels have rendered and layout is stable
          if ("fitContent" in chartModel && typeof chartModel.fitContent === "function") {
            chartModel.fitContent();
          }
          // Wait one more frame for fitContent to take effect before updating coordinates
          rafId = requestAnimationFrame(() => {
            updateCoordinates();
            setIsResizing(false);
            rafId = null;
          });
        });
      });
      resizeObserver.observe(chartContainer);
    }

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [chartModel, chartContainer, dataKey]);

  if (!coordinates || isHovering || isResizing) {
    return null;
  }

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
      {/* Outer pulsing ring */}
      <div
        className="absolute rounded-full"
        style={{
          width: "10px",
          height: "10px",
          backgroundColor: overrideColor,
          opacity: 0.3,
          transform: "translate(-50%, -50%)",
          animation: "live-dot-pulse 2s ease-in-out infinite",
        }}
      />
      <div
        className="absolute rounded-full"
        style={{
          width: "10px",
          height: "10px",
          backgroundColor: overrideColor,
          opacity: 0.3,
          transform: "translate(-50%, -50%)",
          animation: "live-dot-pulse 2s ease-in-out infinite 0.5s",
        }}
      />
      {/* Inner dot */}
      <div
        className="absolute rounded-full border-2"
        style={{
          width: "10px",
          height: "10px",
          backgroundColor: overrideColor,
          left: "50%",
          top: "50%",
          borderColor: SURFACE1_COLOR,
          transform: "translate(-50%, -50%)",
        }}
      />
      <style>
        {`
          @keyframes live-dot-pulse {
            0% {
              transform: translate(-50%, -50%) scale(1);
              opacity: 0.5;
            }
            75% {
              transform: translate(-50%, -50%) scale(3);
              opacity: 0;
            }
            100% {
              transform: translate(-50%, -50%) scale(3);
              opacity: 0;
            }
          }
        `}
      </style>
    </div>
  );
}
