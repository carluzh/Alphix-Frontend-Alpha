import { useEffect, useState } from 'react'
import styled from 'styled-components'
import { ArrowLeftIcon } from 'lucide-react'
import { IconClone2, IconCheck, IconTriangleWarningFilled } from 'nucleo-micro-bold-essential'
import { ExternalLink } from 'lucide-react'
import { SCAN_LINK, TokenInfo as Token } from '../constants'
import { useActiveWeb3 } from '../hooks/useWeb3Provider'
import { copyToClipboard } from '../utils'
import { useImportedTokens } from '../hooks/useTokens'
import { cn } from '@/lib/utils'
import { TokenLogo } from './FallbackTokenIcon'

// Red CTA — identical geometry to the Swap CTA (Button in Widget/styled.tsx),
// but uses the Alphix canonical destructive HSL token. Kept as styled.button so
// theme.buttonRadius / theme.boxShadow stay consistent with the rest of the
// widget.
const DangerButton = styled.button`
  outline: none;
  border: none;
  border-radius: ${({ theme }) => theme.buttonRadius};
  width: 100%;
  font-size: 1rem;
  font-weight: 500;
  padding: 0.875rem;
  background: hsl(0, 62.8%, 30.6%);
  color: #ffffff;
  cursor: pointer;
  box-shadow: ${({ theme }) => theme.boxShadow};
  transition: background 0.15s ease;

  &:hover {
    background: hsl(0, 62.8%, 34%);
  }

  &:active {
    transform: scale(0.99);
  }
`


function ImportModal({
  token,
  onImport,
  onBack,
}: {
  token: Token
  onImport: () => void
  onBack?: () => void
}) {
  const { chainId } = useActiveWeb3()
  const [isCopied, setIsCopied] = useState(false)
  const { addToken } = useImportedTokens()

  useEffect(() => {
    if (!isCopied) return
    const t = setTimeout(() => setIsCopied(false), 2000)
    return () => clearTimeout(t)
  }, [isCopied])

  const truncatedAddress = `${token.address.slice(0, 6)}...${token.address.slice(-4)}`
  const explorerHref = `${SCAN_LINK[chainId] || ''}/address/${token.address}`

  // Risk callout colors — mirror PriceDeviationCallout "high" severity (red).
  const calloutBg = 'rgba(255, 89, 60, 0.08)'
  const calloutBorder = 'rgba(255, 89, 60, 0.2)'
  const calloutBorderHover = 'rgba(255, 89, 60, 0.4)'
  const calloutIconBg = 'rgba(255, 89, 60, 0.12)'
  const calloutFg = '#FF593C'

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* ── Header (Back + "Import Token") — identical to SelectCurrency. ─── */}
      <div className="flex items-center gap-3 mb-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="flex items-center justify-center w-10 h-10 rounded-lg hover:bg-white/[0.06] active:bg-white/[0.10] transition-colors"
            aria-label="Back"
          >
            <ArrowLeftIcon className="h-5 w-5 text-muted-foreground" />
          </button>
        )}
        <h3 className="text-[15px] font-medium tracking-[-0.01em]">Import Token</h3>
      </div>

      {/* ── Body (scrolls if needed) ─────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto kyber-token-scroll flex flex-col gap-3 pr-1">
        {/* Top segment — Logo + Name (row 1), Address + copy + explorer (row 2). */}
        <div className="flex items-start gap-3 px-3 py-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
          <TokenLogo src={token.logoURI} symbol={token.symbol} size={40} className="rounded-full" />
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-medium leading-tight truncate text-white">
              {token.name || token.symbol}
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="text-[12px] text-muted-foreground/60 font-mono tracking-tight">
                {truncatedAddress}
              </span>
              <button
                type="button"
                onClick={() => {
                  copyToClipboard(token.address)
                  setIsCopied(true)
                }}
                className="relative flex items-center justify-center w-4 h-4 opacity-60 hover:opacity-100 transition-opacity"
                aria-label="Copy address"
              >
                <IconClone2
                  width={12}
                  height={12}
                  className={cn(
                    'absolute inset-0 m-auto text-muted-foreground transition-all duration-200',
                    isCopied ? 'opacity-0 translate-y-1' : 'opacity-100 translate-y-0',
                  )}
                />
                <IconCheck
                  width={12}
                  height={12}
                  className={cn(
                    'absolute inset-0 m-auto text-green-500 transition-all duration-200',
                    isCopied ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1',
                  )}
                />
              </button>
              <a
                href={explorerHref}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center opacity-60 hover:opacity-100 transition-opacity text-muted-foreground"
                aria-label="View on explorer"
              >
                <ExternalLink width={12} height={12} />
              </a>
            </div>
          </div>
        </div>

        {/* Risk callout — PriceDeviationCallout style (high severity). */}
        <div
          className="flex flex-col gap-1 rounded-lg border p-3 transition-colors text-left"
          style={{ backgroundColor: calloutBg, borderColor: calloutBorder }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = calloutBorderHover
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = calloutBorder
          }}
        >
          <div className="flex items-center gap-2">
            <div
              className="flex items-center justify-center p-1.5 rounded-md shrink-0"
              style={{ backgroundColor: calloutIconBg }}
            >
              <IconTriangleWarningFilled
                className="w-3.5 h-3.5"
                style={{ color: calloutFg }}
              />
            </div>
            <span className="text-xs font-medium" style={{ color: calloutFg }}>
              Trade at your own risk!
            </span>
          </div>
          <p className="text-xs font-medium leading-relaxed text-left" style={{ color: calloutFg, opacity: 0.85 }}>
            Anyone can create a token, including fake versions of existing tokens that claim to represent
            projects. If you purchase this token, you may not be able to sell it back.
          </p>
        </div>
      </div>

      {/* ── Pinned CTA — red Swap-button geometry, label "I understand". ─── */}
      <div className="pt-3">
        <DangerButton
          type="button"
          onClick={() => {
            addToken(token)
            onImport()
          }}
        >
          I understand
        </DangerButton>
      </div>
    </div>
  )
}

export default ImportModal
