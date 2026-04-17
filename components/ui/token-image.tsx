"use client";

import Image from 'next/image';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface TokenImageProps {
  src: string;
  alt: string;
  size?: number;
  className?: string;
}

/**
 * TokenImage component that handles external image URLs properly.
 * Uses native img tag for external URLs (like CoinGecko) to avoid
 * Next.js image optimization which gets blocked by CDNs.
 * Uses Next.js Image for local images for optimization benefits.
 */
export function TokenImage({ src, alt, size = 32, className }: TokenImageProps) {
  const [imgSrc, setImgSrc] = useState(src || '/tokens/placeholder.svg');
  const [hasError, setHasError] = useState(false);

  // Sync imgSrc with src prop when it changes
  useEffect(() => {
    setImgSrc(src || '/tokens/placeholder.svg');
    setHasError(false);
  }, [src]);

  // Check if the URL is external (not local)
  const isExternal = imgSrc.startsWith('http://') || imgSrc.startsWith('https://');

  // Use native img for external URLs to completely bypass Next.js
  if (isExternal && !hasError) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imgSrc}
        alt={alt}
        width={size}
        height={size}
        className={cn("rounded-full", className)}
        onError={() => {
          setHasError(true);
          setImgSrc('/tokens/placeholder.svg');
        }}
      />
    );
  }

  // Use Next.js Image for local images (unoptimized to avoid cache-miss issues with small PNGs)
  return (
    <Image
      src={imgSrc}
      alt={alt}
      width={size}
      height={size}
      unoptimized
      className={cn("rounded-full", className)}
      onError={() => {
        setImgSrc('/tokens/placeholder.svg');
      }}
    />
  );
}
