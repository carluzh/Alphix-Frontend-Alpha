import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftIcon, SearchIcon } from 'lucide-react'
import styled from 'styled-components'
import { TokenInfo as TokenDetail, NATIVE_TOKEN, NATIVE_TOKEN_ADDRESS } from '../constants'
import useTokenBalances from '../hooks/useTokenBalances'
import { useTokens } from '../hooks/useTokens'
import { useActiveWeb3 } from '../hooks/useWeb3Provider'
import unknownTokenImg from '../assets/unknown-token.svg?url'
import { useToken } from '../hooks/useToken'
import { formatUnits, isAddress } from '../utils/crypto'
import { cn } from '@/lib/utils'
import { getToken as getPoolToken } from '@/lib/pools-config'

// Curated "Supported Tokens" lists per chain — sourced from config/{base,arbitrum}_pools.json
// via lib/pools-config. ETH on Base resolves via NATIVE_TOKEN[chainId] (not the
// 0x000…0 pools-config address) so the balance lookup hits Kyber's native slot.
const SUPPORTED_SYMBOLS_BY_CHAIN: Record<number, string[]> = {
  8453: ['ETH', 'USDC', 'cbBTC', 'ZFI'],
  42161: ['USDC', 'USDT'],
}

const CHAIN_SWITCHER_META: Record<number, { icon: string; label: string }> = {
  8453: { icon: '/chains/base.svg', label: 'Base' },
  42161: { icon: '/chains/arbitrum.svg', label: 'Arbitrum' },
}
const CHAIN_SWITCHER_ORDER: number[] = [8453, 42161]

// Re-exported because `./DexesSetting` imports it.
export const Input = styled.input`
  font-size: 0.75rem;
  padding: 0.75rem;
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.secondary};
  outline: none;
  border: none;
  color: ${({ theme }) => theme.text};
`

const CHAIN_BADGE_MAP: Record<number, string> = {
  8453: '/chains/base.svg',
  42161: '/chains/arbitrum.svg',
}

function resolveChainBadge(chainId: number | undefined): string | null {
  if (!chainId) return null
  return CHAIN_BADGE_MAP[chainId] || null
}

const formatBalance = (formatted: string): string => {
  const num = parseFloat(formatted || '0')
  if (!isFinite(num) || num === 0) return '0'
  if (num > 0 && num < 0.000001) return formatted
  if (num > 0 && num < 0.001) return '< 0.001'
  const truncated = parseFloat(num.toPrecision(10))
  if (truncated < 1) return truncated.toString()
  return truncated.toFixed(4)
}

interface TokenRowToken extends TokenDetail {
  balance?: bigint
  formattedBalance: string
  isImport?: boolean
}

function TrashGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className}>
      <path
        d="M4 6h12M8 4h4M6 6l1 10a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2l1-10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function NucleoCheck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none">
      <polyline
        points="6.5 10.5 8.75 13 13.5 7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  )
}

function TokenRowItem({
  token,
  isSelected,
  loading,
  onSelect,
}: {
  token: TokenRowToken
  isSelected: boolean
  loading: boolean
  onSelect: () => void
}) {
  const chainBadge = resolveChainBadge(token.chainId)
  const isNative = token.address === NATIVE_TOKEN_ADDRESS
  const addressDisplay = isNative
    ? 'Native'
    : `${token.address.slice(0, 6)}...${token.address.slice(-4)}`
  const displayBalance = formatBalance(token.formattedBalance)

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-2.5 text-left rounded-lg mx-1',
        'hover:bg-white/[0.04] transition-colors',
        isSelected && 'bg-white/[0.03]',
      )}
      style={{ width: 'calc(100% - 8px)' }}
    >
      {/* Token icon + chain badge */}
      <div className="relative shrink-0">
        <img
          src={token.logoURI || unknownTokenImg}
          alt={token.symbol}
          width={36}
          height={36}
          className="w-9 h-9 rounded-full"
          onError={({ currentTarget }) => {
            currentTarget.onerror = null
            currentTarget.src = unknownTokenImg
          }}
        />
        {chainBadge && (
          <img
            src={chainBadge}
            alt=""
            className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-sm ring-2 ring-[var(--surface-bg,var(--card))]"
          />
        )}
      </div>

      {/* Name (title) + Ticker & Address (subtitle): name on top, symbol +
          truncated address on the line below. */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[14px] font-medium leading-tight truncate text-white/90">
            {token.name}
          </span>
          {isSelected && <NucleoCheck className="h-3.5 w-3.5 text-primary shrink-0" />}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[12px] text-white/50 leading-tight">{token.symbol}</span>
          <span className="text-[12px] text-muted-foreground/35 leading-tight">{addressDisplay}</span>
        </div>
      </div>

      <div className="text-right shrink-0">
        {loading ? (
          <div className="h-4 w-14 bg-white/[0.06] rounded-md animate-pulse" />
        ) : (
          <div className="text-[13px] font-medium tabular-nums">{displayBalance}</div>
        )}
      </div>
    </button>
  )
}

const ImportToken = ({
  address,
  onImport,
}: {
  address: string
  onImport: (token: TokenDetail) => void
}) => {
  const token = useToken(address)
  if (!token) return null
  return (
    <div className="w-full flex items-center gap-3 px-4 py-2.5 mx-1" style={{ width: 'calc(100% - 8px)' }}>
      <img
        src={unknownTokenImg}
        alt={token.symbol}
        width={36}
        height={36}
        className="w-9 h-9 rounded-full"
      />
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-medium leading-tight truncate text-white/90">
          {token.symbol}
        </div>
        <div className="text-[12px] text-white/50 leading-tight truncate">{token.name}</div>
      </div>
      <button
        type="button"
        onClick={() => onImport(token)}
        className="px-3 py-1.5 rounded-md text-[12px] font-medium bg-white/[0.06] hover:bg-white/[0.10] text-white/90 transition-colors"
      >
        Import
      </button>
    </div>
  )
}

function SelectCurrency({
  selectedToken,
  onChange,
  onImport,
  onClose,
  onChainSwitch,
}: {
  selectedToken: string
  onChange: (token: TokenDetail) => void
  onImport: (token: TokenDetail) => void
  onClose?: () => void
  onChainSwitch?: (chainId: number) => void
}) {
  const tokens = useTokens()
  const [search, setSearch] = useState('')
  const tokenAddresses = useMemo(() => tokens.map((item) => item.address), [tokens])
  const { balances, loading } = useTokenBalances(tokenAddresses)
  const { chainId, connectedAccount } = useActiveWeb3()
  const isConnected = !!connectedAccount.address

  const hasReceivedBalancesRef = useRef(false)
  const [hasInitialBalances, setHasInitialBalances] = useState(false)
  useEffect(() => {
    if (hasReceivedBalancesRef.current) return
    if (Object.keys(balances).length > 0) {
      hasReceivedBalancesRef.current = true
      setHasInitialBalances(true)
    }
  }, [balances])

  const activeChainMeta = CHAIN_SWITCHER_META[chainId] || CHAIN_SWITCHER_META[8453]
  const nextChainId = useMemo(() => {
    const idx = CHAIN_SWITCHER_ORDER.indexOf(chainId)
    if (idx === -1) return CHAIN_SWITCHER_ORDER[0]
    return CHAIN_SWITCHER_ORDER[(idx + 1) % CHAIN_SWITCHER_ORDER.length]
  }, [chainId])
  const nextChainMeta = CHAIN_SWITCHER_META[nextChainId]

  const networkMode: 'base' | 'arbitrum' = chainId === 42161 ? 'arbitrum' : 'base'

  const supportedTokens: TokenRowToken[] = useMemo(() => {
    const symbols = SUPPORTED_SYMBOLS_BY_CHAIN[chainId] ?? []
    return symbols
      .map((sym): TokenRowToken | null => {
        if (sym === 'ETH') {
          return {
            ...NATIVE_TOKEN[chainId],
            balance: balances[NATIVE_TOKEN_ADDRESS],
            formattedBalance: formatUnits((balances[NATIVE_TOKEN_ADDRESS] || 0n).toString(), 18),
          }
        }
        const tc = getPoolToken(sym, networkMode)
        if (!tc) return null
        const balance = balances[tc.address]
        const formattedBalance = formatUnits((balance || 0n).toString(), tc.decimals)
        return {
          name: tc.name,
          symbol: tc.symbol,
          address: tc.address,
          decimals: tc.decimals,
          chainId,
          logoURI: tc.icon,
          balance,
          formattedBalance,
        }
      })
      .filter((t): t is TokenRowToken => t !== null)
  }, [chainId, networkMode, balances])

  const supportedAddrSet = useMemo(
    () => new Set(supportedTokens.map((t) => t.address.toLowerCase())),
    [supportedTokens],
  )

  const yourTokens: TokenRowToken[] = useMemo(() => {
    if (!isConnected) return []
    return tokens
      .map((item) => {
        const balance = balances[item.address]
        const formattedBalance = formatUnits((balance || 0n).toString(), item.decimals)
        return { ...item, balance, formattedBalance }
      })
      .filter((t) => parseFloat(t.formattedBalance) > 0)
      .filter((t) => !supportedAddrSet.has(t.address.toLowerCase()))
      .sort((a, b) => parseFloat(b.formattedBalance) - parseFloat(a.formattedBalance))
  }, [tokens, balances, isConnected, supportedAddrSet])

  const searchResults: TokenRowToken[] = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return []
    const all: TokenRowToken[] = [
      {
        ...NATIVE_TOKEN[chainId],
        balance: balances[NATIVE_TOKEN_ADDRESS],
        formattedBalance: formatUnits((balances[NATIVE_TOKEN_ADDRESS] || 0n).toString(), 18),
      },
      ...tokens.map((item) => {
        const balance = balances[item.address]
        const formattedBalance = formatUnits((balance || 0n).toString(), item.decimals)
        return { ...item, balance, formattedBalance }
      }),
    ]
    return all.filter(
      (token) =>
        token.address.toLowerCase() === s ||
        token.name.toLowerCase().includes(s) ||
        token.symbol.toLowerCase().includes(s),
    )
  }, [tokens, balances, chainId, search])

  const selectedLower = selectedToken?.toLowerCase()
  const trimmedSearch = search.trim()
  const showImportRow = isAddress(trimmedSearch) && !searchResults.length
  const isEmptySearchHit = !!search && !searchResults.length && !showImportRow

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Custom thin scrollbar — scoped to .kyber-token-scroll */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .kyber-token-scroll::-webkit-scrollbar { width: 4px; }
        .kyber-token-scroll::-webkit-scrollbar-track { background: transparent; }
        .kyber-token-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }
        .kyber-token-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.16); }
        .kyber-token-scroll { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.08) transparent; }
      `,
        }}
      />

      {/* ── Header (Back + "Select Token" + Chain) ────────────────────────
            [40×40 back] [15px medium "Select Token"] [40×40 chain (ml-auto)] */}
      <div className="flex items-center gap-3 mb-3">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center w-10 h-10 rounded-lg hover:bg-white/[0.06] active:bg-white/[0.10] transition-colors"
            aria-label="Back"
          >
            <ArrowLeftIcon className="h-5 w-5 text-muted-foreground" />
          </button>
        )}
        <h3 className="text-[15px] font-medium tracking-[-0.01em]">Select Token</h3>

        {/* Chain toggle — cycles Base ↔ Arbitrum. */}
        <button
          type="button"
          onClick={onChainSwitch ? () => onChainSwitch(nextChainId) : undefined}
          className={cn(
            'ml-auto flex items-center justify-center w-10 h-10 rounded-lg transition-colors',
            onChainSwitch && 'hover:bg-white/[0.06] active:bg-white/[0.10]',
          )}
          title={
            onChainSwitch && nextChainMeta
              ? `Switch to ${nextChainMeta.label}`
              : activeChainMeta?.label
          }
          aria-label={
            onChainSwitch && nextChainMeta
              ? `Switch to ${nextChainMeta.label}`
              : activeChainMeta?.label
          }
          disabled={!onChainSwitch}
        >
          <img
            src={activeChainMeta?.icon || '/chains/base.svg'}
            alt={activeChainMeta?.label || 'Chain'}
            className="w-5 h-5 rounded-sm"
          />
        </button>
      </div>

      {/* ── Search Bar ─────────────────────────────────────────────────── */}
      <div className="relative mb-4">
        <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground/50" />
        <input
          type="text"
          placeholder="Search token or paste address"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 h-12 rounded-lg bg-white/[0.03] border border-white/[0.06] focus:outline-none focus:ring-1 focus:ring-white/[0.12] text-[14px] text-white/90 placeholder:text-muted-foreground/40"
          autoFocus
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto kyber-token-scroll -mx-2 py-1">
        {showImportRow && <ImportToken address={trimmedSearch} onImport={onImport} />}

        {isEmptySearchHit && (
          <div className="py-12 text-center">
            <p className="text-[13px] text-muted-foreground/50">
              No tokens found for &ldquo;{search}&rdquo;
            </p>
            <p className="text-[12px] text-muted-foreground/35 mt-1">
              Paste a token address to import.
            </p>
          </div>
        )}

        {search ? (
          searchResults.map((token) => {
            const isSelected = !!selectedLower && token.address.toLowerCase() === selectedLower
            const showSkeleton = loading && !hasInitialBalances && !token.balance
            return (
              <TokenRowItem
                key={`s-${token.address}-${token.chainId}`}
                token={token}
                isSelected={isSelected}
                loading={showSkeleton}
                onSelect={() => onChange(token)}
              />
            )
          })
        ) : (
          <>
            {supportedTokens.length > 0 && (
              <>
                <div className="px-5 pt-2 pb-1.5">
                  <span className="text-[13px] font-medium text-muted-foreground/60 tracking-[-0.01em]">
                    Supported Tokens
                  </span>
                </div>
                {supportedTokens.map((token) => {
                  const isSelected = !!selectedLower && token.address.toLowerCase() === selectedLower
                  const showSkeleton = loading && !hasInitialBalances && !token.balance
                  return (
                    <TokenRowItem
                      key={`sup-${token.address}-${token.chainId}`}
                      token={token}
                      isSelected={isSelected}
                      loading={showSkeleton}
                      onSelect={() => onChange(token)}
                    />
                  )
                })}
              </>
            )}

            {isConnected && yourTokens.length > 0 && (
              <>
                <div className="px-5 pt-3 pb-1.5">
                  <span className="text-[13px] font-medium text-muted-foreground/60 tracking-[-0.01em]">
                    Your Tokens
                  </span>
                </div>
                {yourTokens.map((token) => {
                  const isSelected = !!selectedLower && token.address.toLowerCase() === selectedLower
                  const showSkeleton = loading && !hasInitialBalances && !token.balance
                  return (
                    <TokenRowItem
                      key={`y-${token.address}-${token.chainId}`}
                      token={token}
                      isSelected={isSelected}
                      loading={showSkeleton}
                      onSelect={() => onChange(token)}
                    />
                  )
                })}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default SelectCurrency
