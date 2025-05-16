"use client";

import React from 'react';
import { motion } from 'framer-motion';

interface PulsatingDotProps {
  color: string;
  size?: number; // Radius of the inner static dot
  className?: string;
}

export const PulsatingDot: React.FC<PulsatingDotProps> = ({
  color,
  size = 2,
  className = '',
}) => {
  // Calculate viewBox and center based on the potential size of the pulsating outer dot
  // Outer dot scale goes up to 1.8 * size for radius. Diameter = 2 * 1.8 * size = 3.6 * size
  // Add some padding, e.g., 1 unit around.
  const svgSize = size * 3.6 + 2; 
  const center = svgSize / 2;

  return (
    <svg
      width={svgSize}
      height={svgSize}
      viewBox={`0 0 ${svgSize} ${svgSize}`}
      className={className}
      style={{ overflow: 'visible' }} // Ensure halo isn't clipped by svg boundaries if calculations are tight
    >
      {/* Inner static dot */}
      <circle cx={center} cy={center} r={size} fill={color} />
      {/* Outer pulsating halo */}
      <motion.circle
        cx={center}
        cy={center}
        r={size} // Base radius, will be scaled
        fill={color}
        // stroke={color} // Stroke can make it look thicker than intended with fill
        // strokeWidth="0.5"
        animate={{
          scale: [1, 1.8, 1, 1.8, 1], // Adjusted scale for smaller halo
          opacity: [0.2, 0.5, 0, 0.5, 0], // Adjusted opacity
        }}
        transition={{
          duration: 6, // Slowed down animation to 6 seconds
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />
    </svg>
  );
}; 