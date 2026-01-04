"use client";

import { useEffect } from "react";

// Alphix custom cross pattern - unique from Uniswap's dots
const CROSS_PATTERN = {
  color: "#2A2A2A", // Subtle crosses
  spacing: "20px", // Grid spacing
};

// Background color for fade overlay (if enabled)
const BACKGROUND_COLOR = "hsl(0 0% 7%)";

export function useApplyChartTextureEffects({
  chartDivElement,
  showDottedBackground,
  showLeftFadeOverlay,
}: {
  chartDivElement: HTMLDivElement | null;
  showDottedBackground: boolean;
  showLeftFadeOverlay: boolean;
}) {
  useEffect(() => {
    if (!chartDivElement || (!showDottedBackground && !showLeftFadeOverlay)) {
      return undefined;
    }

    const applyBackgroundTexture = (): void => {
      // Find the chart canvas container - it's a div with position relative inside the main container
      // Lightweight-charts structure: container > div[style*="position: relative"]
      const chartArea = chartDivElement.querySelector(
        ':scope > div[style*="position: relative"]'
      ) as HTMLDivElement | null;

      // Fallback: try table structure (older versions)
      const chartTd = chartDivElement.querySelector(
        ":scope > div > table > tr:first-child > td:nth-child(2)"
      ) as HTMLTableCellElement | null;

      const targetElement = chartArea || chartTd;

      if (!targetElement) {
        return;
      }

      targetElement.style.position = "relative";

      // Find or create the pattern overlay div
      let patternOverlay = targetElement.querySelector(
        "[data-chart-pattern-overlay]"
      ) as HTMLDivElement | null;

      if (showDottedBackground) {
        if (!patternOverlay) {
          patternOverlay = document.createElement("div");
          patternOverlay.setAttribute("data-chart-pattern-overlay", "true");
          patternOverlay.style.position = "absolute";
          patternOverlay.style.top = "0";
          patternOverlay.style.left = "0";
          patternOverlay.style.right = "0";
          patternOverlay.style.bottom = "0";
          patternOverlay.style.pointerEvents = "none";
          patternOverlay.style.zIndex = "0";
          // Insert at the beginning so it's behind the canvas
          targetElement.insertBefore(patternOverlay, targetElement.firstChild);
        }

        // Create cross/plus pattern using two perpendicular lines
        const crossPattern = `
          linear-gradient(${CROSS_PATTERN.color} 1px, transparent 1px),
          linear-gradient(90deg, ${CROSS_PATTERN.color} 1px, transparent 1px)
        `;
        patternOverlay.style.backgroundImage = crossPattern;
        patternOverlay.style.backgroundSize = `${CROSS_PATTERN.spacing} ${CROSS_PATTERN.spacing}`;
        patternOverlay.style.backgroundPosition = "center center";
      } else if (patternOverlay) {
        patternOverlay.remove();
      }

      // Handle left fade overlay (disabled by default)
      if (showLeftFadeOverlay) {
        const existingOverlay = targetElement.querySelector(
          "[data-chart-fade-overlay]"
        ) as HTMLElement | null;

        if (!existingOverlay) {
          const overlay = document.createElement("div");
          overlay.setAttribute("data-chart-fade-overlay", "true");
          overlay.style.position = "absolute";
          overlay.style.top = "0";
          overlay.style.left = "0";
          overlay.style.bottom = "0";
          overlay.style.width = "40px";
          overlay.style.height = "100%";
          overlay.style.background = `linear-gradient(to right, ${BACKGROUND_COLOR} 0%, transparent 100%)`;
          overlay.style.pointerEvents = "none";
          overlay.style.zIndex = "1";
          targetElement.appendChild(overlay);
        }
      }
    };

    applyBackgroundTexture();

    // Use observers to update when chart layout changes (chart renders asynchronously)
    const mutationObserver = new MutationObserver(applyBackgroundTexture);
    mutationObserver.observe(chartDivElement, { childList: true, subtree: true });

    const resizeObserver = new ResizeObserver(applyBackgroundTexture);
    resizeObserver.observe(chartDivElement);

    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [chartDivElement, showDottedBackground, showLeftFadeOverlay]);
}
