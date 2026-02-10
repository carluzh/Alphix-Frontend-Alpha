'use client'

import { useState, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Loader2 } from 'lucide-react'
import { TOS_SECTIONS } from '@/lib/tos-content'

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

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [])

  const isLoading = isSigningMessage || isSendingToBackend
  const canConfirm = checked && hasScrolledToBottom && !isLoading

  return (
    <div className="flex items-center justify-center p-4 sm:p-6">
      <style dangerouslySetInnerHTML={{__html: `
        .tos-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .tos-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .tos-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 3px;
        }
        .tos-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
        .tos-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
        }
      `}} />
      <div className="w-full max-w-2xl flex flex-col rounded-xl border border-sidebar-border/40 bg-sidebar p-5 sm:p-6 shadow-2xl">
        {/* Header */}
        <h2 className="text-lg font-semibold text-white mb-4">
          Terms of Service
        </h2>

        {/* Scrollable ToS content */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="tos-scrollbar max-h-[55vh] overflow-y-auto rounded-lg border border-sidebar-border/40 bg-black/20 p-4 sm:p-5 text-xs leading-relaxed text-muted-foreground"
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

        {/* Scroll hint — hidden once scrolled, clickable */}
        {!hasScrolledToBottom && (
          <button
            onClick={scrollToBottom}
            className="text-xs text-muted-foreground/60 text-center animate-pulse mt-3 hover:text-muted-foreground transition-colors cursor-pointer"
          >
            Scroll to the bottom to continue
          </button>
        )}

        {/* Action area — revealed after scrolling to bottom */}
        <div
          className={`flex flex-col gap-3 transition-all duration-300 ${
            hasScrolledToBottom
              ? 'opacity-100 max-h-40 mt-4'
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
                : 'border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] text-white/75 cursor-not-allowed'
            }`}
            style={!canConfirm ? { backgroundImage: 'url(/patterns/button-wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
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
              'Accept'
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default ToSAcceptanceModal
