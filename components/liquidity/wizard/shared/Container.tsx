'use client';

/**
 * Container - Step container component for wizard
 * Converted from Uniswap's Tamagui to Tailwind
 */

import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

interface ContainerProps {
  children: React.ReactNode;
  className?: string;
  animate?: boolean;
  delay?: number;
}

export function Container({ children, className, animate = false, delay = 0 }: ContainerProps) {
  const baseClasses = cn(
    'flex flex-col gap-6 w-full',
    className
  );

  if (animate) {
    return (
      <motion.div
        className={baseClasses}
        initial={{ y: -10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2, delay: delay / 1000 }}
      >
        {children}
      </motion.div>
    );
  }

  return <div className={baseClasses}>{children}</div>;
}

// Animated container for step transitions
interface AnimatedContainerProps {
  children: React.ReactNode;
  show: boolean;
  direction?: 'up' | 'down';
  className?: string;
}

export function AnimatedContainer({
  children,
  show,
  direction = 'down',
  className
}: AnimatedContainerProps) {
  const yOffset = direction === 'down' ? -10 : 10;

  return (
    <AnimatePresence mode="wait">
      {show && (
        <motion.div
          initial={{ y: yOffset, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: yOffset, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className={className}
        >
          <Container>{children}</Container>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
