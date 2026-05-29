import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import useTheme from '../hooks/useTheme'
import { BPS, MAX_SLIPPAGE_IN_BIPS, parseSlippageInput, validateSlippageInput } from './Settings'

type Preset = { bps: number; label: string }

const PRESETS: readonly Preset[] = [
  { bps: 1, label: '0.01%' },
  { bps: 5, label: '0.05%' },
  { bps: 50, label: '0.5%' },
  { bps: 100, label: '1%' },
] as const

const PRESET_BPS_SET = new Set<number>(PRESETS.map(p => p.bps))

const Container = styled.div<{ $embedded?: boolean }>`
  width: ${({ $embedded }) => ($embedded ? 'auto' : '100%')};
`

const TriggerRow = styled.button`
  appearance: none;
  border: none;
  background: transparent;
  font-family: inherit;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0;
  cursor: pointer;

  &:focus-visible {
    outline: 1px solid ${({ theme }) => theme.stroke};
    outline-offset: 2px;
    border-radius: 4px;
  }
`

const TriggerLabel = styled.span`
  color: ${({ theme }) => theme.subText};
  font-size: 12px;
  font-weight: 400;
`

const TriggerValue = styled.span`
  color: ${({ theme }) => theme.subText};
  font-size: 12px;
  font-weight: 400;
  transition: color 120ms ease;

  ${TriggerRow}:hover & {
    color: ${({ theme }) => theme.text};
  }
`

const ExpandedRow = styled.div<{ $embedded?: boolean }>`
  width: ${({ $embedded }) => ($embedded ? 'auto' : '100%')};
  display: flex;
  align-items: center;
  justify-content: ${({ $embedded }) => ($embedded ? 'flex-end' : 'space-between')};
  gap: 6px;
`

const ExpandedLabel = styled.span`
  color: ${({ theme }) => theme.subText};
  font-size: 12px;
  font-weight: 400;
  flex-shrink: 0;
`

const PresetGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: nowrap;
`

const PresetButton = styled.button<{ isActive: boolean }>`
  appearance: none;
  font-family: inherit;
  border: none;
  height: 26px;
  padding: 0 8px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 6px;
  cursor: pointer;
  transition: color 120ms ease, background-color 120ms ease;

  color: ${({ theme, isActive }) => (isActive ? theme.text : theme.subText)};
  background: ${({ theme, isActive }) => (isActive ? `${theme.dialog}` : 'transparent')};

  &:hover {
    color: ${({ theme }) => theme.text};
    background: ${({ theme }) => theme.dialog};
  }

  &:focus-visible {
    outline: 1px solid ${({ theme }) => theme.stroke};
    outline-offset: 1px;
  }
`

const CustomFieldWrap = styled.div<{ isCritical: boolean; isFocused: boolean }>`
  display: flex;
  align-items: center;
  gap: 2px;
  height: 26px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid
    ${({ theme, isCritical, isFocused }) =>
      isCritical ? theme.error : isFocused ? theme.subText : theme.stroke};
  background: transparent;
  transition: border-color 120ms ease;
`

const CustomInput = styled.input<{ isCritical: boolean }>`
  width: 40px;
  height: 100%;
  padding: 0;
  border: none;
  outline: none;
  background: transparent;
  color: ${({ theme, isCritical }) => (isCritical ? theme.error : theme.text)};
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  text-align: center;

  &::placeholder {
    color: ${({ theme }) => theme.subText};
  }
`

const CustomPercent = styled.span`
  color: ${({ theme }) => theme.subText};
  font-size: 12px;
  font-weight: 500;
`

const ErrorSlot = styled.div<{ isCritical: boolean }>`
  font-size: 12px;
  font-weight: 400;
  color: ${({ theme, isCritical }) => (isCritical ? theme.error : theme.warning)};
  text-align: right;
  margin-top: 4px;
`

const formatBpsAsPercent = (bps: number): string => {
  const pct = bps / 100
  return `${pct.toFixed(2)}%`
}

export default function Slippage({
  slippage,
  setSlippage,
  embedded = false,
}: {
  slippage: number
  setSlippage: (value: number) => void
  embedded?: boolean
}) {
  const theme = useTheme()
  const [show, setShow] = useState(embedded)
  const [isCustomEditing, setIsCustomEditing] = useState(false)
  const [v, setV] = useState<string>(() => {
    if (PRESET_BPS_SET.has(slippage)) return ''
    return (slippage / 100).toString()
  })
  const [isFocus, setIsFocus] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { isValid, message } = validateSlippageInput(v)
  const isCustomActive = !PRESET_BPS_SET.has(slippage)
  const isCritical = !isValid

  useEffect(() => {
    if (!show || embedded) return
    const handler = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShow(false)
        setIsCustomEditing(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [show, embedded])

  const handlePresetClick = (bps: number) => {
    setSlippage(bps)
    setV('')
    if (!embedded) setShow(false)
    setIsCustomEditing(false)
  }

  const handleCustomClick = () => {
    setIsCustomEditing(true)
    if (!isCustomActive) setV('')
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    if (value === '') {
      setV('')
      return
    }
    if (value === '.') {
      setV('0.')
      return
    }
    if (!/^\d*\.?\d*$/.test(value)) return
    const parts = value.split('.')
    if (parts[1] && parts[1].length > 2) return
    setV(value)
  }

  const commitCustom = () => {
    const { isValid: ok } = validateSlippageInput(v)
    if (ok && v !== '') {
      const parsed = parseSlippageInput(v)
      if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= MAX_SLIPPAGE_IN_BIPS) {
        setSlippage(parsed)
      }
    }
  }

  const handleInputBlur = () => {
    setIsFocus(false)
    commitCustom()
  }

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commitCustom()
      if (!embedded) setShow(false)
      setIsCustomEditing(false)
    } else if (e.key === 'Escape') {
      if (!embedded) setShow(false)
      setIsCustomEditing(false)
    }
  }

  return (
    <Container ref={containerRef} $embedded={embedded}>
      {!show ? (
        <TriggerRow
          type="button"
          onClick={() => setShow(true)}
          aria-label="Edit max slippage"
          aria-expanded={false}
        >
          <TriggerLabel>Slippage</TriggerLabel>
          <TriggerValue>{formatBpsAsPercent(slippage)}</TriggerValue>
        </TriggerRow>
      ) : (
        <div style={{ width: embedded ? 'auto' : '100%' }}>
          <ExpandedRow $embedded={embedded}>
            {!embedded && <ExpandedLabel>Slippage</ExpandedLabel>}

            <PresetGroup>
              {PRESETS.map(preset => {
                const isActive = !isCustomActive && slippage === preset.bps
                return (
                  <PresetButton
                    key={preset.bps}
                    type="button"
                    isActive={isActive}
                    onClick={() => handlePresetClick(preset.bps)}
                  >
                    {preset.label}
                  </PresetButton>
                )
              })}

              {isCustomEditing || isCustomActive ? (
                <CustomFieldWrap isCritical={isCritical && v !== ''} isFocused={isFocus}>
                  <CustomInput
                    ref={inputRef}
                    type="text"
                    isCritical={isCritical && v !== ''}
                    placeholder="Custom"
                    value={v}
                    onChange={handleInputChange}
                    onFocus={() => setIsFocus(true)}
                    onBlur={handleInputBlur}
                    onKeyDown={handleInputKeyDown}
                  />
                  <CustomPercent>%</CustomPercent>
                </CustomFieldWrap>
              ) : (
                <PresetButton
                  type="button"
                  isActive={false}
                  onClick={handleCustomClick}
                >
                  Custom
                </PresetButton>
              )}
            </PresetGroup>
          </ExpandedRow>

          {message && (
            <ErrorSlot isCritical={isCritical}>{message}</ErrorSlot>
          )}
        </div>
      )}
    </Container>
  )
}
