'use client';
import { createPortal } from 'react-dom';
import { ReactNode, useEffect, useState } from 'react';

// Minimal Portal stub for the vendored Kyber widget. Source equivalent of
// @kyber/ui/portal: render children into document.body via React.createPortal.
export const Portal = ({ children }: { children: ReactNode }) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(children, document.body);
};
