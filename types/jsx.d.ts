import * as React from 'react';

// types/jsx.d.ts

declare namespace JSX {
  interface IntrinsicElements {
    "appkit-button": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    // Add other appkit web components here if needed, e.g.:
    // "appkit-account-button": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    // "appkit-network-button": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
  }
} 