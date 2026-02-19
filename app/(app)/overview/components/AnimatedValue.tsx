"use client";

import { useEffect, useRef, memo } from "react";
import { useSpring, useTransform, motion, useReducedMotion } from "framer-motion";

interface AnimatedValueProps {
  value: number;
  /** Format function for the final display */
  formatValue?: (value: number) => string;
  /** Animation duration in seconds */
  duration?: number;
  /** Spring stiffness (higher = snappier) */
  stiffness?: number;
  /** Spring damping (higher = less bouncy) */
  damping?: number;
  /** CSS class for the container */
  className?: string;
  /** Delay before animation starts (in seconds) */
  delay?: number;
}

/**
 * AnimatedValue - Smooth number morphing animation using Framer Motion springs
 *
 * Features:
 * - Smooth counting up/down when values change
 * - Respects prefers-reduced-motion
 * - Customizable spring physics
 * - Custom formatting support
 */
export const AnimatedValue = memo(function AnimatedValue({
  value,
  formatValue = (v) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  duration = 0.8,
  stiffness = 100,
  damping = 30,
  className,
  delay = 0,
}: AnimatedValueProps) {
  const prefersReducedMotion = useReducedMotion();
  const prevValue = useRef(value);
  const hasAnimated = useRef(false);

  // Spring animation for the number
  const spring = useSpring(prevValue.current, {
    stiffness,
    damping,
    duration: prefersReducedMotion ? 0 : duration,
  });

  // Transform spring value to formatted string
  const display = useTransform(spring, (latest) => formatValue(latest));

  useEffect(() => {
    // Handle delay for initial animation
    if (!hasAnimated.current && delay > 0) {
      const timer = setTimeout(() => {
        spring.set(value);
        hasAnimated.current = true;
        prevValue.current = value;
      }, delay * 1000);
      return () => clearTimeout(timer);
    }

    // Animate to new value
    spring.set(value);
    prevValue.current = value;
    hasAnimated.current = true;
  }, [value, spring, delay]);

  // If reduced motion, just show the formatted value directly
  if (prefersReducedMotion) {
    return <span className={className}>{formatValue(value)}</span>;
  }

  return <motion.span className={className}>{display}</motion.span>;
});

/**
 * AnimatedCurrency - Specialized variant for USD values
 */
export const AnimatedCurrency = memo(function AnimatedCurrency({
  value,
  className,
  showCents = true,
  delay = 0,
}: {
  value: number;
  className?: string;
  showCents?: boolean;
  delay?: number;
}) {
  const formatCurrency = (v: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: showCents ? 2 : 0,
      maximumFractionDigits: showCents ? 2 : 0,
    }).format(v);
  };

  return (
    <AnimatedValue
      value={value}
      formatValue={formatCurrency}
      className={className}
      stiffness={80}
      damping={25}
      delay={delay}
    />
  );
});

/**
 * AnimatedPoints - Specialized variant for points display (4 decimals)
 */
export const AnimatedPoints = memo(function AnimatedPoints({
  value,
  className,
  delay = 0,
}: {
  value: number;
  className?: string;
  delay?: number;
}) {
  const formatPoints = (v: number) => {
    // Show 2 decimals if below 100, otherwise 0
    const decimals = v < 100 ? 2 : 0;
    return v.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  };

  return (
    <AnimatedValue
      value={value}
      formatValue={formatPoints}
      className={className}
      stiffness={60}
      damping={20}
      delay={delay}
    />
  );
});

/**
 * AnimatedPercentage - Specialized variant for percentage values
 */
export const AnimatedPercentage = memo(function AnimatedPercentage({
  value,
  className,
  decimals = 2,
  delay = 0,
}: {
  value: number;
  className?: string;
  decimals?: number;
  delay?: number;
}) {
  const formatPercent = (v: number) => {
    return `${v.toFixed(decimals)}%`;
  };

  return (
    <AnimatedValue
      value={value}
      formatValue={formatPercent}
      className={className}
      stiffness={100}
      damping={30}
      delay={delay}
    />
  );
});

export default AnimatedValue;
