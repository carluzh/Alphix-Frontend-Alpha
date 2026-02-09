'use client'

import { Button } from '@/components/ui/button'
import { useCookieConsent } from '@/hooks/useCookieConsent'

export function CookieBanner() {
  const { showBanner, acceptAll, acceptNecessaryOnly } = useCookieConsent()

  if (!showBanner) return null

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 p-3 sm:p-4">
      <div className="mx-auto max-w-2xl rounded-xl border border-sidebar-border/40 bg-sidebar/95 backdrop-blur-md p-4 sm:p-5 shadow-2xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <p className="text-xs sm:text-sm text-muted-foreground flex-1">
            We use cookies to operate and improve our services. Analytics cookies
            are only enabled with your consent.{' '}
            <a
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sidebar-primary hover:underline"
            >
              Privacy Policy
            </a>
          </p>
          <div className="flex gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={acceptNecessaryOnly}
              className="text-xs border-sidebar-border text-muted-foreground hover:text-white"
            >
              Necessary Only
            </Button>
            <Button
              size="sm"
              onClick={acceptAll}
              className="text-xs bg-button-primary hover-button-primary text-sidebar-primary border border-sidebar-primary"
            >
              Accept All
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default CookieBanner
