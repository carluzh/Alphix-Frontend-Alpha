'use client'

import { useState, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Loader2, ShieldCheck } from 'lucide-react'
import { TOS_SECTIONS, TOS_LAST_UPDATED } from '@/lib/tos-content'

export interface ToSAcceptanceModalProps {
  onConfirm: () => Promise<void>
  isSigningMessage: boolean
  isSendingToBackend: boolean
}

export function ToSAcceptanceModal({
  onConfirm,
  isSigningMessage,
  isSendingToBackend,
}: ToSAcceptanceModalProps) {
  const [checked, setChecked] = useState(false)
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el || hasScrolledToBottom) return

    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 30) {
      setHasScrolledToBottom(true)
    }
  }, [hasScrolledToBottom])

  const isLoading = isSigningMessage || isSendingToBackend
  const canConfirm = checked && hasScrolledToBottom && !isLoading

  return (
    <div className="flex flex-1 items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-2xl flex flex-col gap-4 rounded-xl border border-sidebar-border/40 bg-sidebar p-5 sm:p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div
            className="flex items-center justify-center p-2.5 rounded-lg shrink-0"
            style={{ backgroundColor: 'rgba(244, 85, 2, 0.12)' }}
          >
            <ShieldCheck className="w-5 h-5 text-sidebar-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">
              Terms of Service
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Last updated: {TOS_LAST_UPDATED}. Please read carefully before proceeding.
            </p>
          </div>
        </div>

        {/* Scrollable ToS content */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="max-h-[55vh] overflow-y-auto rounded-lg border border-sidebar-border/40 bg-black/20 p-4 sm:p-5 text-xs leading-relaxed text-muted-foreground scrollbar-thin scrollbar-track-transparent scrollbar-thumb-sidebar-border/50"
        >
          {TOS_SECTIONS.map((section, i) => (
            <div key={i} className={i > 0 ? 'mt-4' : ''}>
              {section.heading && (
                <h3 className="text-sm font-semibold text-white/90 mb-1.5">
                  {section.heading}
                </h3>
              )}
              {section.body && (
                <p className="whitespace-pre-line">{section.body}</p>
              )}
            </div>
          ))}
        </div>

        {/* Scroll hint — hidden once scrolled */}
        {!hasScrolledToBottom && (
          <p className="text-xs text-muted-foreground/60 text-center animate-pulse">
            Scroll to the bottom to continue
          </p>
        )}

        {/* Action area — revealed after scrolling to bottom */}
        <div
          className={`flex flex-col gap-3 transition-all duration-300 ${
            hasScrolledToBottom
              ? 'opacity-100 max-h-40'
              : 'opacity-0 max-h-0 overflow-hidden pointer-events-none'
          }`}
        >
          {/* Checkbox */}
          <label className="flex items-center gap-3 cursor-pointer py-1">
            <Checkbox
              checked={checked}
              onCheckedChange={(v) => setChecked(v === true)}
              className="data-[state=checked]:bg-white data-[state=checked]:border-white data-[state=checked]:text-black"
            />
            <span className="text-sm text-muted-foreground">
              I have read and agree to the{' '}
              <a
                href="/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sidebar-primary hover:brightness-125 hover:underline transition-colors"
              >
                Terms of Service
              </a>
              {' '}and{' '}
              <a
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sidebar-primary hover:brightness-125 hover:underline transition-colors"
              >
                Privacy Policy
              </a>
            </span>
          </label>

          {/* Confirm button */}
          <Button
            onClick={onConfirm}
            disabled={!canConfirm}
            className={`w-full transition-all duration-200 overflow-hidden ${
              canConfirm
                ? 'bg-button-primary hover-button-primary text-sidebar-primary border border-sidebar-primary'
                : 'border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] text-white/75 cursor-not-allowed opacity-50'
            }`}
            style={!canConfirm ? { backgroundImage: 'url(/patterns/button-default.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
          >
            {isSigningMessage ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Signing...
              </>
            ) : isSendingToBackend ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Confirming...
              </>
            ) : (
              'Accept & Continue'
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default ToSAcceptanceModal
