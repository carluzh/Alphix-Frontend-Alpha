"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <>
      <style jsx global>{`
        @keyframes toastSlideIn {
          0% { transform: translateX(120%); opacity: 0; }
          70% { transform: translateX(-4px); }
          100% { transform: translateX(0); opacity: 1; }
        }

        [data-sonner-toast] {
          animation: toastSlideIn 0.4s cubic-bezier(0.34, 1.3, 0.64, 1) !important;
        }

        [data-sonner-toast][data-styled="true"] {
          padding: 1rem 2.5rem 1rem 1rem;
          min-height: 64px;
          border: 1px solid var(--sidebar-border);
          border-radius: 0.5rem;
          background-clip: padding-box;
          overflow: hidden;
          display: flex;
          align-items: center;
        }

        [data-sonner-toast]:not([data-type])[data-styled="true"],
        [data-sonner-toast][data-type="default"][data-styled="true"] {
          background: var(--swap-background) !important;
          background-image: linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, transparent 60%) !important;
          border: 1px solid transparent !important;
          background-origin: border-box;
          background-clip: padding-box;
          box-shadow: inset 1px 0 0 0 rgba(255, 255, 255, 0.15), inset 0 0 0 1px var(--sidebar-border);
        }

        [data-sonner-toast]:not([data-type]) [data-close-button],
        [data-sonner-toast][data-type="default"] [data-close-button] {
          display: none !important;
        }

        [data-sonner-toast][data-type="success"][data-styled="true"],
        [data-sonner-toast][data-type="error"][data-styled="true"] {
          background: var(--swap-background) !important;
          border: 1px solid transparent !important;
          background-origin: border-box;
          background-clip: padding-box;
        }

        [data-sonner-toast][data-type="success"][data-styled="true"] {
          background-image: linear-gradient(135deg, rgba(34, 197, 94, 0.08) 0%, transparent 60%) !important;
          box-shadow: inset 1px 0 0 0 rgba(34, 197, 94, 0.15), inset 0 0 0 1px var(--sidebar-border);
        }

        [data-sonner-toast][data-type="error"][data-styled="true"] {
          background-image: linear-gradient(135deg, rgba(239, 68, 68, 0.08) 0%, transparent 60%) !important;
          box-shadow: inset 1px 0 0 0 rgba(239, 68, 68, 0.15), inset 0 0 0 1px var(--sidebar-border);
        }

        [data-sonner-toast] [data-icon] {
          width: 1.25rem !important;
          height: 1.25rem !important;
          min-width: 1.25rem !important;
          margin: 0 0.375rem 0 0 !important;
        }

        [data-sonner-toast] [data-icon] svg {
          width: 1.25rem !important;
          height: 1.25rem !important;
        }

        [data-sonner-toast][data-type="success"] [data-icon],
        [data-sonner-toast][data-type="error"] [data-icon] {
          align-self: flex-start !important;
        }

        [data-sonner-toast] [data-close-button] {
          position: absolute !important;
          right: 0.75rem !important;
          top: 50% !important;
          transform: translateY(-50%) !important;
          width: 1rem !important;
          height: 1rem !important;
          border: none !important;
          background: transparent !important;
          color: white !important;
          opacity: 0.5 !important;
          cursor: pointer !important;
          padding: 0 !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          z-index: 10 !important;
          left: auto !important;
        }

        [data-sonner-toast][data-type="success"] [data-close-button],
        [data-sonner-toast][data-type="error"] [data-close-button] {
          top: 1rem !important;
          transform: none !important;
        }

        [data-sonner-toast] [data-close-button]:hover {
          opacity: 1 !important;
        }

        [data-sonner-toast] [data-close-button] svg {
          width: 1rem !important;
          height: 1rem !important;
          stroke-width: 2 !important;
        }

        [data-sonner-toast] [data-title] {
          font-size: 0.875rem !important;
          font-weight: 400 !important;
          line-height: 1.25rem !important;
        }

        [data-sonner-toast] [data-description] {
          font-size: 0.8125rem !important;
          margin-top: 0.25rem !important;
          opacity: 0.7 !important;
        }

        [data-sonner-toast] [data-content] {
          display: flex;
          align-items: flex-start;
          gap: 0.375rem;
        }

        [data-sonner-toast] [data-action] {
          position: absolute !important;
          bottom: 1rem !important;
          left: calc(1rem + 1.25rem + 0.75rem) !important;
          font-size: 0.8125rem !important;
          font-weight: 400 !important;
          color: currentColor !important;
          opacity: 0.7 !important;
          cursor: pointer !important;
          text-decoration: underline !important;
          border: none !important;
          background: none !important;
          padding: 0 !important;
          display: inline-block !important;
          width: fit-content !important;
          line-height: 1.25rem !important;
          height: auto !important;
        }

        [data-sonner-toast] [data-action]:hover {
          color: white !important;
          opacity: 1 !important;
        }

        [data-sonner-toast]:has([data-action]) {
          padding-bottom: 2.5rem !important;
          min-height: 80px !important;
          height: auto !important;
        }

        [data-sonner-toast][data-expanded] {
          height: auto !important;
          max-height: none !important;
          overflow: visible !important;
        }
      `}</style>
      <Sonner
        theme={theme as ToasterProps["theme"]}
        className="toaster group"
        closeButton
        dir="auto"
        {...props}
      />
    </>
  )
}

export { Toaster }
