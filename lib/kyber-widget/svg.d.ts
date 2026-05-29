// SVG type declarations for the vendored Kyber widget.
// Mirrors the widget's expectations: default import = React component,
// `?url` suffix = URL string (handled by next.config.mjs SVGR rules).
declare module '*.svg' {
  import * as React from 'react';
  const Component: React.FC<React.SVGProps<SVGSVGElement>>;
  export default Component;
}
declare module '*.svg?url' {
  const url: string;
  export default url;
}
