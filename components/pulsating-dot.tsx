"use client";

import React from 'react';
import { motion } from 'framer-motion';

interface PulsatingDotProps {
  color: string;
  size?: number; // Radius of the inner static dot
  className?: string;
  pulseBaseRadius?: number; // New prop: Base radius for the pulsating circle before scaling
}

export const PulsatingDot: React.FC<PulsatingDotProps> = ({
  color,
  size = 2, // Default static dot size (radius)
  className = '',
  pulseBaseRadius, // Destructure new prop
}) => {
  // Calculate viewBox based on the maximum potential size of the pulsating outer dot
  // Max scale is 1.8, applied to pulseBaseRadius (which can default to size if not provided)
  const effectivePulseBaseRadius = pulseBaseRadius || size;
  const maxPulsationDiameter = effectivePulseBaseRadius * 1.8 * 2; // Diameter = radius * scale * 2
  const svgPadding = 2; // Extra padding around for overflow
  const svgSize = maxPulsationDiameter + svgPadding; 
  const center = svgSize / 2;

  return (
    <svg
      width={svgSize}
      height={svgSize}
      viewBox={`0 0 ${svgSize} ${svgSize}`}
      className={className}
      style={{ overflow: 'visible' }} // Ensure halo isn't clipped by svg boundaries
    >
      {/* Inner static dot */}
      <circle cx={center} cy={center} r={size} fill={color} />
      {/* Outer pulsating halo */}
      <motion.circle
        cx={center}
        cy={center}
        r={effectivePulseBaseRadius} // Use effectivePulseBaseRadius as base for animation
        fill={color}
        animate={{
          scale: [0.3, 1.8, 0.3], // Start and reset at a much smaller scale to appear to grow from behind
          opacity: [0.8, 0, 0],   // Fade out, then stay invisible at the end to force a "pop" on repeat
        }}
        transition={{
          duration: 1.5, // Total duration of one pulse cycle
          times: [0, 0.7, 1], // Keyframe times: 0%, 70%, 100%
          repeat: Infinity,
          ease: 'linear', // Linear transition for a sharp fade-out and instantaneous reset
        }}
      />
    </svg>
  );
}; 