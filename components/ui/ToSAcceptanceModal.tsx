'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Loader2, ShieldCheck } from 'lucide-react'
import { TOS_SECTIONS } from '@/lib/tos-content'

export interface ToSAcceptanceModalProps {
  isOpen: boolean
  onConfirm: () => Promise<void>
  isSigningMessage: boolean
}

export function ToSAcceptanceModal({
  isOpen,
  onConfirm,
  isSigningMessage,
}: ToSAcceptanceModalProps) {
  const [tosChecked, setTosChecked] = useState(false)
  const [privacyChecked, setPrivacyChecked] = useState(false)

  const canConfirm = tosChecked && privacyChecked && !isSigningMessage

  if (!isOpen) return null

  return (
    <Dialog open={isOpen} modal={false}>
      {/* Overlay - not dismissable */}
      <div
        className="fixed inset-0 z-50 bg-black/80"
        aria-hidden="true"
      />
      <DialogContent
        className="sm:max-w-lg p-0 [&>button]:hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <div className="flex flex-col gap-3 p-6">
          {/* Icon */}
          <div
            className="flex items-center justify-center p-3 rounded-lg self-start"
            style={{ backgroundColor: 'rgba(244, 85, 2, 0.12)' }}
          >
            <ShieldCheck className="w-6 h-6 text-sidebar-primary" />
          </div>

          {/* Title */}
          <DialogHeader className="space-y-0 text-left">
            <DialogTitle className="text-lg">
              Terms of Service
            </DialogTitle>
          </DialogHeader>

          {/* Description */}
          <DialogDescription className="text-sm text-muted-foreground">
            Please read the Terms of Service carefully before proceeding.
          </DialogDescription>

          {/* Scrollable ToS content */}
          <div
            className="max-h-[50vh] overflow-y-auto rounded-lg border border-sidebar-border/40 bg-black/20 p-4 text-xs leading-relaxed text-muted-foreground scrollbar-thin scrollbar-track-transparent scrollbar-thumb-sidebar-border/50"
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

          {/* Checkboxes */}
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-3 cursor-pointer py-1.5">
              <Checkbox
                checked={tosChecked}
                onCheckedChange={(checked) => setTosChecked(checked === true)}
                className="data-[state=checked]:bg-white data-[state=checked]:border-white data-[state=checked]:text-black"
              />
              <span className="text-sm text-muted-foreground">
                I have read and understood the{' '}
                <a
                  href="https://app.alphix.fi/ToS.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sidebar-primary hover:brightness-125 hover:underline transition-colors"
                >
                  Terms of Service
                </a>
                .
              </span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer py-1.5">
              <Checkbox
                checked={privacyChecked}
                onCheckedChange={(checked) => setPrivacyChecked(checked === true)}
                className="data-[state=checked]:bg-white data-[state=checked]:border-white data-[state=checked]:text-black"
              />
              <span className="text-sm text-muted-foreground">
                I have read and understood the{' '}
                <a
                  href="https://app.alphix.fi/PrivacyPolicy.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sidebar-primary hover:brightness-125 hover:underline transition-colors"
                >
                  Privacy Policy
                </a>
                .
              </span>
            </label>
          </div>

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
            ) : (
              'Confirm'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default ToSAcceptanceModal
