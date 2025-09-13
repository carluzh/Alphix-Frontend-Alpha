"use client";

import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import Image from 'next/image';

interface Star {
  id: number;
  x: number;
  y: number;
  size: number;
  opacity: number;
  isSparkle: boolean;
  isLargeSparkle: boolean;
  pulseDuration: number; // Random pulse duration 3-10s
  pulseVariation: number; // Random opacity variation 10%-30%
}

interface ShootingStar {
  id: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  duration: number;
  delay: number;
}

export function StarrySkyBackground() {
  const [stars, setStars] = useState<Star[]>([]);
  const [shootingStars, setShootingStars] = useState<ShootingStar[]>([]);
  const [mounted, setMounted] = useState(false);
  const [progress, setProgress] = useState(0);
  const lastTsRef = useRef<number | null>(null);
  const [revealProgress, setRevealProgress] = useState(0); // 0 -> 1 left-to-right reveal
  const revealRafRef = useRef<number | null>(null);

  // Generate stars with varied properties
  useEffect(() => {
    const generateStars = () => {
      const starCount = 54; // 45 + 20% = 54 stars
      const newStars: Star[] = [];

      for (let i = 0; i < starCount; i++) {
        const isSparkle = Math.random() < 0.16; // Doubled to ~16% (roughly 1 in 6) for more sparkles
        const isLargeSparkle = isSparkle && Math.random() < 0.4; // 40% of sparkles are large
        newStars.push({
          id: i,
          x: Math.random() * 100,
          y: Math.random() * 100,
          size: isSparkle ? (isLargeSparkle ? 10 : 6) : Math.random() * 2.5 + 0.8, // Sparkles: 6-10px, Regular: 0.8-3.3px
          opacity: Math.random() * 0.4 + 0.5, // 50%-90% opacity
          isSparkle,
          isLargeSparkle,
          pulseDuration: Math.random() * 7 + 3, // 3-10s pulse duration
          pulseVariation: Math.random() * 0.2 + 0.1, // 10%-30% opacity variation
        });
      }

      setStars(newStars);
    };

    // Removed shooting stars generation

    const timer = setTimeout(() => {
      generateStars();
      setMounted(true);

      // Start 2s left-to-right reveal animation
      const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const durationMs = 5000;
      const step = (ts: number) => {
        const now = ts || (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const t = Math.max(0, Math.min(1, (now - start) / durationMs));
        setRevealProgress(t);
        if (t < 1) {
          revealRafRef.current = requestAnimationFrame(step);
        }
      };
      revealRafRef.current = requestAnimationFrame(step);
    }, 3000); // 3 second delay before appearing

    return () => {
      clearTimeout(timer);
      if (revealRafRef.current) cancelAnimationFrame(revealRafRef.current);
    };
  }, []);

  // Continuous star movement animation
  useEffect(() => {
    if (!mounted) return;
    let raf = 0;
    const baseRate = 1 / 600; // Full loop in ~10 minutes

    const loop = (ts: number) => {
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dt = Math.max(0, (ts - lastTsRef.current) / 1000);
      lastTsRef.current = ts;

      setProgress(prev => (prev + dt * baseRate) % 1);
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mounted]);

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
      {/* Preserve existing background - this layer should be transparent */}
      <div className="absolute inset-0 bg-transparent" />

      {/* Star field */}
      <div className="absolute inset-0">
        <svg width="100%" height="100%" className="absolute inset-0">
          <defs>
            <filter id="starBlur" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="1.5" result="blur"/>
              <feMerge>
                <feMergeNode in="blur"/>
              </feMerge>
            </filter>
            <filter id="starSharp">
              <feGaussianBlur stdDeviation="0.3"/>
            </filter>
          </defs>
          {stars.map((star) => {
            const baseX = star.x / 100;
            const phase = (baseX + progress) % 1;
            
            // Calculate viewport dimensions for proper positioning
            const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1920;
            const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 1080;
            
            // Parabolic curve: creates an interesting arc motion
            const parabolaStrength = 30 + (star.y / 100) * 20; // 30-50 pixel curve strength
            const parabolaOffset = Math.sin(phase * Math.PI) * parabolaStrength; // Sine wave creates parabola
            
            const svgX = phase * viewportWidth; // Absolute pixel position
            const svgY = Math.max(20, Math.min(viewportHeight - 20, (star.y / 100) * viewportHeight + parabolaOffset * 0.5)); // Add slight downward curve

            // Simple fade-in reveal factor
            const revealFactorMain = revealProgress;
            
            return (
              <React.Fragment key={star.id}>
                <motion.g
                  initial={{ opacity: 0 }}
                  animate={{ 
                    opacity: [
                      Math.max(0.1, star.opacity - star.pulseVariation), 
                      Math.min(1, star.opacity + star.pulseVariation), 
                      Math.max(0.1, star.opacity - star.pulseVariation)
                    ]
                  }}
                  transition={{ 
                    opacity: { duration: star.pulseDuration, repeat: Infinity, repeatType: 'mirror' },
                    delay: star.x / 100 * 2
                  }}
                >
                  {star.isSparkle ? (
                    // Sparkle stars using PNG image
                    <g transform={`translate(${svgX}, ${svgY})`} style={{ opacity: revealFactorMain }}>
                      <foreignObject 
                        x={-star.size/2} 
                        y={-star.size/2} 
                        width={star.size} 
                        height={star.size}
                      >
                        <div className="w-full h-full flex items-center justify-center">
                          <Image
                            src="/sparkle.png"
                            alt="sparkle"
                            width={star.size}
                            height={star.size}
                            className="filter brightness-0 invert"
                            style={{ 
                              filter: 'brightness(0) invert(1)', 
                              transform: star.isLargeSparkle ? 'scale(1.5)' : 'scale(1)' 
                            }}
                          />
                        </div>
                      </foreignObject>
                    </g>
                  ) : (
                    // Regular square stars with blur background for shine
                    <g transform={`translate(${svgX}, ${svgY})`} style={{ opacity: revealFactorMain }}>
                      {/* Blur background for shine effect */}
                      <rect
                        x={-star.size * 1.2}
                        y={-star.size * 1.2}
                        width={star.size * 2.4}
                        height={star.size * 2.4}
                        fill="white"
                        filter="url(#starBlur)"
                        opacity={star.opacity * 0.3}
                      />
                      {/* Main square star */}
                      <rect
                        x={-star.size / 2}
                        y={-star.size / 2}
                        width={star.size}
                        height={star.size}
                        fill="white"
                        filter="url(#starSharp)"
                      />
                    </g>
                  )}
                </motion.g>
                
                {/* Seamless wrap-around clone */}
                <motion.g
                  initial={{ opacity: 0 }}
                  animate={{ 
                    opacity: [
                      Math.max(0.1, star.opacity - star.pulseVariation), 
                      Math.min(1, star.opacity + star.pulseVariation), 
                      Math.max(0.1, star.opacity - star.pulseVariation)
                    ]
                  }}
                  transition={{ 
                    opacity: { duration: star.pulseDuration, repeat: Infinity, repeatType: 'mirror' },
                    delay: star.x / 100 * 2
                  }}
                >
                  {star.isSparkle ? (
                    // Wrap-around sparkle clone
                    <g transform={`translate(${(phase - 1) * viewportWidth}, ${svgY})`} style={{ opacity: revealProgress }}>
                      <foreignObject 
                        x={-star.size/2} 
                        y={-star.size/2} 
                        width={star.size} 
                        height={star.size}
                      >
                        <div className="w-full h-full flex items-center justify-center">
                          <Image
                            src="/sparkle.png"
                            alt="sparkle"
                            width={star.size}
                            height={star.size}
                            className="filter brightness-0 invert"
                            style={{ 
                              filter: 'brightness(0) invert(1)', 
                              transform: star.isLargeSparkle ? 'scale(1.5)' : 'scale(1)' 
                            }}
                          />
                        </div>
                      </foreignObject>
                    </g>
                  ) : (
                    // Wrap-around regular star clone
                    <g transform={`translate(${(phase - 1) * viewportWidth}, ${svgY})`} style={{ opacity: revealProgress }}>
                      <rect
                        x={-star.size * 1.2}
                        y={-star.size * 1.2}
                        width={star.size * 2.4}
                        height={star.size * 2.4}
                        fill="white"
                        filter="url(#starBlur)"
                        opacity={star.opacity * 0.3}
                      />
                      <rect
                        x={-star.size / 2}
                        y={-star.size / 2}
                        width={star.size}
                        height={star.size}
                        fill="white"
                        filter="url(#starSharp)"
                      />
                    </g>
                  )}
                </motion.g>
              </React.Fragment>
            );
          })}
          
        </svg>
      </div>
    </div>
  );
}