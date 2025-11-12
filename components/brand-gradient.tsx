"use client";

import React from 'react';
import { cn } from '@/lib/utils';

interface BrandGradientProps {
  className?: string;
  variant?: 'background' | 'text';
  intensity?: 'subtle' | 'medium' | 'strong';
  children?: React.ReactNode;
}

/**
 * BrandGradient - Animated dot gradient using brand colors (#f94706, #ff7919)
 * 
 * Features:
 * - Multiple animated dots with fluid movement
 * - Uses brand colors: #f94706 (orange) and #ff7919 (lighter orange)
 * - 20s smooth animation cycle
 * - Works for backgrounds and text
 * 
 * Usage Examples:
 * 
 * 1. Background overlay:
 *    <div className="relative">
 *      <BrandGradient variant="background" intensity="subtle" />
 *      <YourContent />
 *    </div>
 * 
 * 2. Text gradient:
 *    <BrandGradient variant="text" intensity="strong">
 *      Your Branded Text
 *    </BrandGradient>
 * 
 * 3. Border (use CSS class):
 *    <div className="brand-gradient-border p-4">
 *      Content with animated border
 *    </div>
 * 
 * 4. Button (use CSS class):
 *    <button className="brand-gradient-button px-4 py-2">
 *      Click Me
 *    </button>
 */
export function BrandGradient({ 
  className, 
  variant = 'background',
  intensity = 'medium',
  children 
}: BrandGradientProps) {
  const intensityClass = {
    subtle: 'opacity-20',
    medium: 'opacity-40',
    strong: 'opacity-60'
  }[intensity];

  if (variant === 'text') {
    return (
      <span 
        className={cn(
          "brand-gradient-text inline-block",
          intensityClass,
          className
        )}
      >
        {children}
      </span>
    );
  }

  if (variant === 'background') {
    return (
      <div 
        className={cn(
          "brand-gradient-bg absolute inset-0 pointer-events-none",
          intensityClass,
          className
        )}
      />
    );
  }

  return null;
}

