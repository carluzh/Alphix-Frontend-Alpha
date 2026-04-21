"use client";

import { memo, useState } from 'react';
import { cn } from '@/lib/utils';

interface TokenImageProps {
  src: string;
  alt: string;
  size?: number;
  className?: string;
}

const PLACEHOLDER = '/tokens/placeholder.svg';

/**
 * TokenImage — renders a token icon. Uses a plain <img> for both local and external
 * sources to avoid Next.js Image's loading-state placeholder, which causes a visible
 * flash on every parent re-render. Falls back to a placeholder on error.
 *
 * Memoized so unrelated parent re-renders (settings changes, query refetches) don't
 * cause the image to remount.
 */
function TokenImageImpl({ src, alt, size = 32, className }: TokenImageProps) {
  const [hasError, setHasError] = useState(false);
  const displaySrc = !src || hasError ? PLACEHOLDER : src;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={displaySrc}
      alt={alt}
      width={size}
      height={size}
      className={cn("rounded-full", className)}
      onError={() => setHasError(true)}
    />
  );
}

export const TokenImage = memo(TokenImageImpl);
