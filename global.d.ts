import type { MotionProps } from 'framer-motion';

declare global {
    namespace JSX {
        interface IntrinsicElements {
            'appkit-button': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
            // Allow any custom tag safely
            [elemName: string]: any;
        }
    }
    interface Window {
        swapBuildData?: any;
    }
}

// Fix Framer Motion types for React 19 compatibility
// This extends the motion component types to include standard HTML attributes
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

// This line is crucial for making this file a module.
export {}; 