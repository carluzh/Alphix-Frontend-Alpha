import { useState } from 'react'
import unknownTokenImg from '../assets/unknown-token.svg?url'

/**
 * FallbackTokenIcon
 *
 * Renders the canonical Kyberswap unknown-token glyph (grey circle with the
 * question-mark + pattern from `lib/kyber-widget/assets/unknown-token.svg`)
 * whenever we don't have a usable logo for a token. We deliberately do NOT
 * fall back to a symbol-derived initials chip — the symbol can be empty or
 * start with a stray control byte from a malformed ERC20 decode, which
 * produced visibly broken glyphs (see useToken.ts).
 *
 * Sized via `size` (pixels). The SVG is imported as a URL string and rendered
 * via a plain <img>, matching the Token Selector pattern. SVGR's React-component
 * output had hardcoded width/height in the source SVG that ignored prop-passed
 * sizes, causing the glyph to render at 24px inside larger containers.
 */
export function FallbackTokenIcon({
  size,
  className,
}: {
  symbol?: string
  size: number
  className?: string
}) {
  return (
    <img
      src={unknownTokenImg}
      width={size}
      height={size}
      className={'block rounded-full shrink-0' + (className ? ` ${className}` : '')}
      aria-hidden="true"
      alt=""
    />
  )
}

/**
 * TokenLogo
 *
 * <img>-with-fallback. When `src` is missing or onError fires, swaps to
 * <FallbackTokenIcon>. Use this anywhere the widget renders a token logo
 * so broken/missing images degrade to the Kyberswap unknown-token glyph
 * instead of a broken-image placeholder.
 */
export function TokenLogo({
  src,
  symbol,
  size = 28,
  alt,
  className,
}: {
  src: string | undefined | null
  symbol: string
  size?: number
  alt?: string
  className?: string
}) {
  const [errored, setErrored] = useState(false)
  if (!src || errored) {
    return <FallbackTokenIcon symbol={symbol} size={size} className={className} />
  }
  return (
    <img
      src={src}
      alt={alt ?? symbol}
      width={size}
      height={size}
      className={className}
      onError={() => setErrored(true)}
    />
  )
}

export default FallbackTokenIcon
