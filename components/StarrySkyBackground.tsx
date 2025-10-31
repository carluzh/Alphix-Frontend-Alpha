"use client";

import React, { useEffect, useRef, useState, useMemo } from 'react';
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

export function StarrySkyBackground() {
  const [stars, setStars] = useState<Star[]>([]);
  const [mounted, setMounted] = useState(false);
  const [progress, setProgress] = useState(0);
  const lastTsRef = useRef<number | null>(null);
  const [revealProgress, setRevealProgress] = useState(0); // 0 -> 1 left-to-right reveal
  const revealRafRef = useRef<number | null>(null);
  const viewportDimensionsRef = useRef({ width: 1920, height: 1080 });

  // Cache viewport dimensions
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateDimensions = () => {
      viewportDimensionsRef.current = {
        width: window.innerWidth,
        height: window.innerHeight
      };
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

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

    const timer = setTimeout(() => {
      generateStars();
      setMounted(true);

      // Start 5s left-to-right reveal animation
      const start = performance.now();
      const durationMs = 5000;
      const step = (ts: number) => {
        const t = Math.max(0, Math.min(1, (ts - start) / durationMs));
        setRevealProgress(t);
        if (t < 1) {
          revealRafRef.current = requestAnimationFrame(step);
        }
      };
      revealRafRef.current = requestAnimationFrame(step);
    }, 1000); // 1 second delay before appearing

    return () => {
      clearTimeout(timer);
      if (revealRafRef.current) cancelAnimationFrame(revealRafRef.current);
    };
  }, []);

  // Continuous star movement animation - throttled to 30fps
  useEffect(() => {
    if (!mounted) return;
    let raf = 0;
    const baseRate = 1 / 600; // Full loop in ~10 minutes
    const throttleMs = 1000 / 30; // 30fps
    let lastUpdateTime = 0;

    const loop = (ts: number) => {
      if (lastTsRef.current == null) lastTsRef.current = ts;

      // Throttle updates to 30fps
      if (ts - lastUpdateTime < throttleMs) {
        raf = requestAnimationFrame(loop);
        return;
      }

      const dt = Math.max(0, (ts - lastTsRef.current) / 1000);
      lastTsRef.current = ts;
      lastUpdateTime = ts;

      setProgress(prev => (prev + dt * baseRate) % 1);
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mounted]);

  // Memoize star calculations
  const starElements = useMemo(() => {
    if (!mounted || stars.length === 0) return null;

    const { width: viewportWidth, height: viewportHeight } = viewportDimensionsRef.current;

    return stars.map((star) => {
      const baseX = star.x / 100;
      const phase = (baseX + progress) % 1;

      // Parabolic curve: creates an interesting arc motion
      const parabolaStrength = 30 + (star.y / 100) * 20; // 30-50 pixel curve strength
      const parabolaOffset = Math.sin(phase * Math.PI) * parabolaStrength;

      const svgX = phase * viewportWidth;
      const svgY = Math.max(20, Math.min(viewportHeight - 20, (star.y / 100) * viewportHeight + parabolaOffset * 0.5));

      const StarContent = star.isSparkle ? (
        <g transform={`translate(${svgX}, ${svgY})`} style={{ opacity: revealProgress }}>
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
        <g transform={`translate(${svgX}, ${svgY})`} style={{ opacity: revealProgress }}>
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
      );

      const WrapClone = star.isSparkle ? (
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
      );

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
            {StarContent}
          </motion.g>

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
            {WrapClone}
          </motion.g>
        </React.Fragment>
      );
    });
  }, [mounted, stars, progress, revealProgress]);

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
      <div className="absolute inset-0 bg-transparent" />
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
          {starElements}
        </svg>
      </div>
    </div>
  );
}