// Global type definitions

import type { MotionProps } from 'framer-motion';

declare global {
  type Maybe<T> = T | undefined | null

  namespace JSX {
    interface IntrinsicElements {
      'appkit-button': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
      [elemName: string]: any;
    }
  }

  interface Window {
    DEBUG?: boolean
    swapBuildData?: any;
  }
}

// Fix Framer Motion types for React 19 compatibility
declare module 'framer-motion' {
  export interface MotionProps {
    className?: string;
    style?: React.CSSProperties;
    onClick?: React.MouseEventHandler<Element>;
    onMouseDown?: React.MouseEventHandler<Element>;
    onHoverStart?: () => void;
    onHoverEnd?: () => void;
    role?: string;
    'aria-label'?: string;
    'aria-hidden'?: boolean;
    tabIndex?: number;
    id?: string;
  }

  export interface HTMLMotionProps<T> extends MotionProps, React.HTMLAttributes<T> {}
}

export {}
