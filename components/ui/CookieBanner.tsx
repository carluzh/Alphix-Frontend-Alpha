'use client'

import { Button } from '@/components/ui/button'
import { useCookieConsent } from '@/hooks/useCookieConsent'

export function CookieBanner() {
  const { showBanner, acceptAll, acceptNecessaryOnly } = useCookieConsent()

  if (!showBanner) return null

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 flex justify-center p-4">
      <div className="max-w-2xl rounded-lg border border-sidebar-border/40 bg-sidebar p-4 shadow-2xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <p className="text-xs sm:text-sm text-muted-foreground flex-1">
            We use cookies to enhance your browsing experience and analyze site traffic.{' '}
            <a
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground underline hover:text-foreground transition-colors"
            >
              Learn more
            </a>
          </p>
          <div className="flex gap-2 shrink-0">
            <Button
              size="sm"
              onClick={acceptAll}
              className="text-xs bg-button-primary hover-button-primary text-sidebar-primary"
            >
              Accept
            </Button>
            <button
              onClick={acceptNecessaryOnly}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1"
            >
              Decline
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default CookieBanner
