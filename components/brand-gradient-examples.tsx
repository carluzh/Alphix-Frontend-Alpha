"use client";

import React from 'react';
import { BrandGradient } from './brand-gradient';
import { Button } from './ui/button';

/**
 * Example usage of BrandGradient component
 * 
 * This file demonstrates how to use the brand gradient system
 * across different UI elements for consistent branding.
 */
export function BrandGradientExamples() {
  return (
    <div className="space-y-8 p-8">
      <h1 className="text-2xl font-bold mb-6">Brand Gradient Examples</h1>

      {/* Text Gradient */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Text Gradient</h2>
        <div className="space-y-2">
          <BrandGradient variant="text" intensity="strong">
            <h1 className="text-4xl font-bold">Alphix</h1>
          </BrandGradient>
          <BrandGradient variant="text" intensity="medium">
            <p className="text-xl">Animated brand text</p>
          </BrandGradient>
          <BrandGradient variant="text" intensity="subtle">
            <span className="text-sm">Subtle gradient text</span>
          </BrandGradient>
        </div>
      </section>

      {/* Background Overlay */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Background Overlay</h2>
        <div className="relative h-32 bg-container rounded-lg overflow-hidden">
          <BrandGradient variant="background" intensity="subtle" />
          <div className="relative z-10 p-4">
            <p className="text-white">Content with animated gradient background</p>
          </div>
        </div>
      </section>

      {/* Border */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Animated Border</h2>
        <div className="brand-gradient-border p-6 rounded-lg bg-container">
          <p className="text-white">Content with animated gradient border</p>
        </div>
      </section>

      {/* Button */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Button with Gradient</h2>
        <button className="brand-gradient-button px-6 py-3 rounded-lg text-white font-medium">
          Gradient Button
        </button>
      </section>

      {/* Line/Divider */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Animated Line</h2>
        <div className="relative h-1 bg-container rounded-full overflow-hidden">
          <BrandGradient variant="background" intensity="medium" />
        </div>
      </section>
    </div>
  );
}








