declare global {
    namespace JSX {
        interface IntrinsicElements {
            'appkit-button': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
        }
    }
    interface Window {
        swapBuildData?: any;
    }
}

// This line is crucial for making this file a module.
export {}; 