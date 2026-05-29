import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { ArrowLeftIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import useTheme from '../hooks/useTheme'
import AlertIcon from '../assets/alert.svg'
import { Dex } from '../hooks/useSwap'
import InfoHelper from './InfoHelper'
import Slippage from './Slippage'

const TTL_PRESETS = [10, 20, 30] as const

const TTLGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`

const TTLPreset = styled.button<{ $active: boolean }>`
  appearance: none;
  border: none;
  font-family: inherit;
  height: 26px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 6px;
  cursor: pointer;
  color: ${({ theme, $active }) => ($active ? theme.text : theme.subText)};
  background: ${({ theme, $active }) => ($active ? theme.dialog : 'transparent')};
  transition: color 120ms ease, background-color 120ms ease;
  &:hover {
    color: ${({ theme }) => theme.text};
    background: ${({ theme }) => theme.dialog};
  }
`

const TTLCustom = styled.div<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 2px;
  height: 26px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid ${({ theme, $active }) => ($active ? theme.subText : theme.stroke)};
  background: transparent;
  font-size: 12px;
  font-weight: 500;
  color: ${({ theme, $active }) => ($active ? theme.text : theme.subText)};
  transition: border-color 120ms ease, color 120ms ease;
  input {
    width: 56px;
    border: none;
    outline: none;
    background: transparent;
    text-align: center;
    color: inherit;
    font: inherit;
    padding: 0;
  }
`

const SavedBadgeWrap = styled.span<{ $visible: boolean }>`
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  opacity: ${({ $visible }) => ($visible ? 1 : 0)};
  transition: opacity 200ms ease;
  pointer-events: none;
`

const HighlightRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 6px;
  padding: 8px 12px;
`

const DarkRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: rgba(255, 255, 255, 0.012);
  border-radius: 6px;
  padding: 8px 12px;
`

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const Row = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`

const Label = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.subText};
  display: inline-flex;
  align-items: center;
  text-align: left;
`

const TTLInput = styled.div`
  display: flex;
  align-items: center;
  padding: 4px 8px;
  gap: 4px;
  border-radius: 6px;
  background: ${({ theme }) => theme.secondary};
  color: ${({ theme }) => theme.text};
  font-size: 12px;
  font-weight: 500;
  text-align: right;

  input {
    border: none;
    outline: none;
    padding: 0;
    background: transparent;
    text-align: right;
    color: ${({ theme }) => theme.text};
    width: 36px;
    font-size: 12px;
  }
`

export const BPS = 10_000
export const MAX_SLIPPAGE_IN_BIPS = 2_000

export const parseSlippageInput = (str: string): number => Math.round(Number.parseFloat(str) * 100)
export const validateSlippageInput = (str: string): { isValid: boolean; message?: string } => {
  if (str === '') {
    return {
      isValid: true,
    }
  }

  const numberRegex = /^\s*([0-9]+)(\.\d+)?\s*$/
  if (!str.match(numberRegex)) {
    return {
      isValid: false,
      message: `Enter a valid slippage percentage`,
    }
  }

  const rawSlippage = parseSlippageInput(str)

  if (Number.isNaN(rawSlippage)) {
    return {
      isValid: false,
      message: `Enter a valid slippage percentage`,
    }
  }

  if (rawSlippage < 0) {
    return {
      isValid: false,
      message: `Enter a valid slippage percentage`,
    }
  } else if (rawSlippage < 50) {
    return {
      isValid: true,
      message: `Your transaction may fail`,
    }
  } else if (rawSlippage > MAX_SLIPPAGE_IN_BIPS) {
    return {
      isValid: false,
      message: `Enter a smaller slippage percentage`,
    }
  } else if (rawSlippage > 500) {
    return {
      isValid: true,
      message: `Your transaction may be frontrun`,
    }
  }

  return {
    isValid: true,
  }
}

const LegacySlippageWrapper = styled.div`
  border-radius: 999px;
  margin-top: 8px;
  background: ${({ theme }) => theme.secondary};
  padding: 2px;
  display: flex;
`

const LegacySlippageItem = styled.div<{ isActive: boolean }>`
  position: relative;
  border-radius: 999px;
  color: ${({ theme, isActive }) => (isActive ? theme.text : theme.subText)};
  font-size: 12px;
  padding: 4px;
  font-weight: 500;
  flex: 2;
  display: flex;
  align-items: center;
  gap: 4px;
  justify-content: center;
  background: ${({ theme, isActive }) => (isActive ? theme.dialog : theme.secondary)};
  cursor: pointer;
`

const LegacyInput = styled.input<{ isActive: boolean }>`
  background: ${({ theme, isActive }) => (isActive ? theme.dialog : theme.secondary)};
  border: none;
  outline: none;
  color: ${({ theme }) => theme.text};
  text-align: right;
  width: 100%;
  font-size: 12px;
  padding: 0;
`

export const SlippageInput = ({
  slippage,
  setSlippage,
}: {
  slippage: number
  setSlippage: (value: number) => void
}) => {
  const [v, setV] = useState(() => {
    if ([5, 10, 50, 100].includes(slippage)) return ''
    return ((slippage * 100) / BPS).toString()
  })

  const theme = useTheme()
  const [isFocus, setIsFocus] = useState(false)
  const { isValid, message } = validateSlippageInput(v)

  return (
    <>
      <LegacySlippageWrapper>
        <LegacySlippageItem isActive={slippage === 5} onClick={() => setSlippage(5)}>
          0.05%
        </LegacySlippageItem>
        <LegacySlippageItem isActive={slippage === 10} onClick={() => setSlippage(10)}>
          0.1%
        </LegacySlippageItem>
        <LegacySlippageItem isActive={slippage === 50} onClick={() => setSlippage(50)}>
          0.5%
        </LegacySlippageItem>
        <LegacySlippageItem isActive={slippage === 100} onClick={() => setSlippage(100)}>
          1%
        </LegacySlippageItem>
        <LegacySlippageItem
          isActive={![5, 10, 50, 100].includes(slippage)}
          style={{
            flex: 3,
            background: isFocus ? theme.dialog : undefined,
            border: message ? (isValid ? `1px solid ${theme.warning}` : `1px solid ${theme.error}`) : undefined,
          }}
        >
          {message && (
            <AlertIcon
              style={{
                position: 'absolute',
                top: 2,
                left: 4,
                width: 20,
                height: 20,
                color: isValid ? theme.warning : theme.error,
              }}
            />
          )}
          <LegacyInput
            isActive={![5, 10, 50, 100].includes(slippage)}
            placeholder="Custom"
            onFocus={() => setIsFocus(true)}
            onBlur={() => {
              setIsFocus(false)
              if (isValid) setSlippage(parseSlippageInput(v))
            }}
            value={v}
            onChange={e => setV(e.target.value)}
          />
          <span>%</span>
        </LegacySlippageItem>
      </LegacySlippageWrapper>
      {message && (
        <div
          style={{
            fontSize: '12px',
            color: isValid ? theme.warning : theme.error,
            textAlign: 'left',
            marginTop: '4px',
          }}
        >
          {message}
        </div>
      )}
    </>
  )
}

const AllowanceToggle = styled.div`
  display: flex;
  gap: 4px;
`

const AllowanceBtn = styled.button<{ $active: boolean }>`
  appearance: none;
  border: none;
  font-family: inherit;
  height: 26px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 6px;
  cursor: pointer;
  color: ${({ theme, $active }) => ($active ? theme.text : theme.subText)};
  background: ${({ theme, $active }) => ($active ? theme.dialog : 'transparent')};
  transition: color 120ms ease, background-color 120ms ease;

  &:hover {
    color: ${({ theme }) => theme.text};
    background: ${({ theme }) => theme.dialog};
  }
`

function Settings({
  slippage,
  setSlippage,
  deadline,
  setDeadline,
  approvalType,
  setApprovalType,
  onClose,
}: {
  slippage: number
  setSlippage: (value: number) => void
  deadline: number
  setDeadline: (value: number) => void
  allDexes?: Dex[]
  excludedDexes?: Dex[]
  onShowSource?: () => void
  approvalType?: 'infinite' | 'exact'
  setApprovalType?: (value: 'infinite' | 'exact') => void
  onClose?: () => void
}) {
  const [saved, setSaved] = useState(false)
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    setSaved(true)
    const t = setTimeout(() => setSaved(false), 1200)
    return () => clearTimeout(t)
  }, [slippage, deadline, approvalType])

  const isCustomDeadline = !TTL_PRESETS.includes(deadline as (typeof TTL_PRESETS)[number])
  const [ttlCustomEditing, setTtlCustomEditing] = useState(false)
  const ttlInputRef = useRef<HTMLInputElement>(null)
  const showTtlCustomInput = ttlCustomEditing || isCustomDeadline

  return (
    <Container>
      <div className="flex items-center gap-3 mb-1">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center justify-center w-10 h-10 rounded-lg hover:bg-white/[0.06] active:bg-white/[0.10] transition-colors"
          aria-label="Close settings"
        >
          <ArrowLeftIcon className="h-5 w-5 text-muted-foreground" />
        </button>
        <h3 className="text-[15px] font-medium tracking-[-0.01em] text-foreground m-0">
          Settings
        </h3>
        <SavedBadgeWrap $visible={saved} aria-live="polite">
          <Badge
            variant="outline"
            className="bg-green-500/20 text-green-500 border-transparent rounded-md inline-block"
          >
            <span className="inline-flex items-center justify-center" style={{ minWidth: 36 }}>
              Saved
            </span>
          </Badge>
        </SavedBadgeWrap>
      </div>

      <HighlightRow>
        <Label>
          Max Slippage
          <InfoHelper
            text="Transaction will revert if there is an adverse rate change that is higher than this %"
          />
        </Label>
        <Slippage slippage={slippage} setSlippage={setSlippage} embedded />
      </HighlightRow>

      <DarkRow>
        <Label>
          Transaction Time Limit
          <InfoHelper
            text="Transaction will revert if it is pending for longer than the indicated time"
          />
        </Label>
        <TTLGroup>
          {TTL_PRESETS.map(p => (
            <TTLPreset
              key={p}
              type="button"
              $active={!isCustomDeadline && deadline === p}
              onClick={() => {
                setTtlCustomEditing(false)
                setDeadline(p)
              }}
            >
              {p}m
            </TTLPreset>
          ))}
          {showTtlCustomInput ? (
            <TTLCustom $active={isCustomDeadline}>
              <input
                ref={ttlInputRef}
                maxLength={5}
                placeholder="Custom"
                value={isCustomDeadline && deadline ? deadline.toString() : ''}
                onChange={e => {
                  const v = +e.target.value
                    .trim()
                    .replace(/[^0-9]/g, '')
                    .replace(/^0[^.]/, '0')
                  setDeadline(v)
                }}
                onBlur={() => {
                  if (!isCustomDeadline) setTtlCustomEditing(false)
                }}
              />
              <span>m</span>
            </TTLCustom>
          ) : (
            <TTLPreset
              type="button"
              $active={false}
              onClick={() => {
                setTtlCustomEditing(true)
                setTimeout(() => ttlInputRef.current?.focus(), 50)
              }}
            >
              Custom
            </TTLPreset>
          )}
        </TTLGroup>
      </DarkRow>

      {approvalType !== undefined && setApprovalType && (
        <HighlightRow>
          <Label>
            Allowance
            <InfoHelper
              text="Infinite allows unlimited token spend without re-approving on future swaps."
            />
          </Label>
          <AllowanceToggle>
            <AllowanceBtn
              type="button"
              $active={approvalType === 'infinite'}
              onClick={() => setApprovalType('infinite')}
            >
              Infinite
            </AllowanceBtn>
            <AllowanceBtn
              type="button"
              $active={approvalType === 'exact'}
              onClick={() => setApprovalType('exact')}
            >
              Exact
            </AllowanceBtn>
          </AllowanceToggle>
        </HighlightRow>
      )}
    </Container>
  )
}

export default Settings
