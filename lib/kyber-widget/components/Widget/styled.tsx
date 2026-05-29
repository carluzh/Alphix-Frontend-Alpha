import styled, { keyframes } from 'styled-components'

const inputGradientFlow = keyframes`
  from { background-position: 0% 0%; }
  to { background-position: 300% 0%; }
`

const arrowGlare = keyframes`
  from { background-position: 0% 0%; }
  to { background-position: 300% 0%; }
`

interface WrapperProps {
  width?: number
  /** When the selector is open, lock the card to a fixed minimum so opening
      the overlay / switching chains doesn't resize it. Otherwise (resting
      state) let the card size to its natural content — no empty margin
      below the CTA. */
  $selectorOpen?: boolean
}

export const Wrapper = styled.div<WrapperProps>`
  border-radius: ${({ theme }) => theme.borderRadius};
  padding: 1rem;
  width: ${({ width }) => `${width || 375}px`};
  background: ${({ theme }) => theme.primary};
  color: ${({ theme }) => theme.text};
  font-family: ${({ theme }) => theme.fontFamily || `"Work Sans", "Inter var", sans-serif`};
  position: relative;
  overflow: hidden;
  border: 1px solid ${({ theme }) => theme.stroke};
  box-shadow: ${({ theme }) => theme.boxShadow};
  height: max-content;
  ${({ $selectorOpen }) => $selectorOpen ? 'min-height: 560px;' : ''}

  svg {
    display: inline-block !important;
    vertical-align: middle !important;
    max-width: none !important;
    flex-shrink: 0 !important;
  }
`

export const Title = styled.div`
  display: flex;
  justify-content: flex-end;
  align-items: center;
`

export const GradientHoverWrap = styled.div`
  position: relative;
  border-radius: ${({ theme }) => theme.borderRadius};
  margin-top: 0.5rem;

  &::before {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: calc(${({ theme }) => theme.borderRadius} + 1px);
    background: linear-gradient(
      45deg,
      #f94706,
      #ff7919 25%,
      #f94706 50%,
      #ff7919 75%,
      #f94706 100%
    );
    background-size: 300% 100%;
    opacity: 0;
    transition: opacity 0.3s ease;
    pointer-events: none;
    z-index: 0;
    animation: ${inputGradientFlow} 10s linear infinite;
  }
  &:hover::before,
  &:focus-within::before {
    opacity: 1;
  }
`

export const InputPanel = styled.div`
  position: relative;
  z-index: 1;                              /* sit above GradientHoverWrap's ::before ring */
  border-radius: ${({ theme }) => theme.borderRadius};
  padding: 1rem;
  background: ${({ theme }) => theme.secondary};
  border: 1px solid rgba(50, 50, 50, 0.6);
  overflow: hidden;
  cursor: default;
  transition: border-color 0.16s ease;
  &:hover {
    border-color: ${({ theme }) => theme.stroke};
  }
  &.ks-hover-left {
    cursor: pointer;
  }
`

export const PanelTopRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
  position: relative;
  z-index: 1;
`

export const PanelLabel = styled.span`
  color: ${({ theme }) => theme.text};
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.25rem;
`

export const BalanceButton = styled.button`
  background: transparent;
  border: none;
  color: ${({ theme }) => theme.subText};
  font-size: 0.75rem;
  line-height: 1rem;
  cursor: pointer;
  padding: 0;
  margin: 0;
  font-family: inherit;
  font-weight: 400;
  transition: color 0.1s ease;
  &:hover {
    color: ${({ theme }) => theme.text};
  }
  &:disabled {
    cursor: default;
    opacity: 0.7;
  }
`

export const PanelBottomRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  position: relative;
  z-index: 1;
`

export const TokenZone = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
  font-size: 1rem;       /* text-base */
  font-weight: 500;
  line-height: 1.5rem;
  img {
    border-radius: 50%;
  }
`

export const InputZone = styled.div`
  flex: 1;
  margin-left: auto;
  max-width: 50%;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  min-height: 50px;       /* keep room for USD line so layout doesn't jump */
  justify-content: center;
`

export const UsdSlot = styled.div`
  position: relative;
  text-align: right;
  font-size: 0.75rem;
  line-height: 1rem;
  min-height: 1.25rem;
  margin-top: 0.125rem;
`

export const UsdText = styled.div`
  color: ${({ theme }) => theme.subText};
  font-variant-numeric: tabular-nums;
  transition: opacity 0.18s ease;
  .ks-hover-right & {
    opacity: 0;
  }
`

export const DotGridOverlay = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0;
  border-radius: inherit;
  transition: opacity 0.2s ease;
  background-image: radial-gradient(circle, rgba(255, 255, 255, 0.18) 1px, transparent 1px);
  background-size: 16px 16px;
  -webkit-mask-image: linear-gradient(to right, rgba(0, 0, 0, 0.7) 0%, rgba(0, 0, 0, 0) 55%);
  mask-image: linear-gradient(to right, rgba(0, 0, 0, 0.7) 0%, rgba(0, 0, 0, 0) 55%);
  z-index: 0;
  .ks-hover-left & { opacity: 1; }
`

export const PercentageCluster = styled.div`
  position: absolute;
  right: 0;
  top: 3px;
  display: flex;
  gap: 0.25rem;
  pointer-events: none;
  .ks-hover-right & {
    pointer-events: auto;
  }
`

export const PctBtn = styled.button`
  height: 1.25rem;
  padding: 0 0.5rem;
  font-size: 10px;
  line-height: 1;
  font-weight: 500;
  font-family: inherit;
  border: 1px solid ${({ theme }) => theme.stroke};
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
  color: ${({ theme }) => theme.text};
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;

  /* Default: hidden + offset up */
  opacity: 0;
  transform: translateY(-0.25rem);
  transition:
    opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.2s cubic-bezier(0.4, 0, 0.2, 1),
    background 0.12s ease;

  /* Revealed when the panel is hovered on the right half */
  .ks-hover-right & {
    opacity: 1;
    transform: translateY(0);
  }

  &:hover {
    background: rgba(255, 255, 255, 0.09);
  }
`

export const InputWrapper = styled.div`
  border-radius: ${({ theme }) => theme.borderRadius};
  padding: 0.75rem;
  background: ${({ theme }) => theme.secondary};
  margin-top: 1rem;
  box-shadow: ${({ theme }) => theme.boxShadow};
`

export const MaxHalfBtn = styled.button`
  outline: none;
  border: none;
  background: ${({ theme }) => theme.interactive};
  border-radius: ${({ theme }) => theme.buttonRadius};
  color: ${({ theme }) => theme.subText};
  font-size: 0.75rem;
  padding: 0.125rem 0.5rem;
  font-weight: 500;
  cursor: pointer;
  margin-right: 0.25rem;

  :hover {
    opacity: 0.8;
  }
`

export const BalanceRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`

export const SettingBtn = styled.button`
  outline: none;
  border: none;
  border-radius: ${({ theme }) => theme.buttonRadius};
  width: 2.25rem;
  height: 2.25rem;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${({ theme }) => theme.subText};

  :hover {
    background: ${({ theme }) => theme.secondary};
  }

  svg {
    width: 1.25rem;
    height: 1.25rem;
  }
`

export const SwitchBtn = styled(SettingBtn)`
  width: 40px;
  height: 40px;
  background: ${({ theme }) => theme.secondary};

  :hover {
    opacity: 0.8;
  }
`

export const AccountBalance = styled.div`
  gap: 4px;
  display: flex;
  align-items: center;
  font-size: 0.75rem;
  color: ${({ theme }) => theme.subText};
`

export const InputRow = styled.div`
  display: flex;
  align-items: center;
  margin-top: 0.75rem;
`

export const Input = styled.input`
  width: 100%;
  font-size: 1.25rem;        /* text-xl */
  line-height: 1.75rem;
  font-weight: 500;
  background: transparent;
  outline: none;
  border: none;
  color: ${({ theme }) => theme.text};
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-family: inherit;
  padding: 0;

  &::placeholder {
    color: ${({ theme }) => theme.subText};
    opacity: 1;
  }

  &:disabled {
    cursor: default;
    color: ${({ theme }) => theme.text};
    -webkit-text-fill-color: ${({ theme }) => theme.text};
    opacity: 1;
  }

  &:disabled::placeholder {
    color: ${({ theme }) => theme.subText};
    -webkit-text-fill-color: ${({ theme }) => theme.subText};
    opacity: 1;
  }
`

export const SelectTokenBtn = styled.button`
  outline: none;
  border: none;
  background: ${({ theme }) => theme.interactive};
  border-radius: ${({ theme }) => theme.buttonRadius};
  padding: 0.375rem 0 0.375rem 0.5rem;
  font-size: 1.125rem;
  color: ${({ theme }) => theme.subText};
  display: flex;
  align-items: center;
  flex-shrink: 0;
  font-weight: 500;
  cursor: pointer;

  :hover {
    opacity: 0.8;
  }
`

export const MiddleRow = styled.div`
  display: flex;
  margin-top: 1rem;
  align-items: center;
  justify-content: space-between;
`

export const MiddleLeft = styled.div`
  display: flex;
  align-items: center;
`

export const IconCircleBtn = styled.button`
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  background: transparent;
  border-radius: 50%;
  cursor: pointer;
  color: ${({ theme }) => theme.subText};
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, color 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.06);
    color: ${({ theme }) => theme.text};
  }
`

export const Button = styled.button`
  outline: none;
  border: none;
  border-radius: ${({ theme }) => theme.buttonRadius};
  width: 100%;
  margin-top: 1rem;
  font-size: 1rem;
  font-weight: 500;
  padding: 0.875rem;
  background: ${({ theme }) => theme.accent};
  color: #FFFFFF;
  cursor: pointer;
  box-shadow: ${({ theme }) => theme.boxShadow};

  :disabled {
    color: ${({ theme }) => theme.subText};
    background: ${({ theme }) => theme.interactive};
    cursor: not-allowed;

    :active {
      transform: none;
    }
  }

  :active {
    transform: scale(0.99);
  }
`

export const Dots = styled.span`
  &::after {
    display: inline-block;
    animation: ellipsis 1.25s infinite;
    content: '.';
    width: 1em;
    text-align: left;
  }
  @keyframes ellipsis {
    0% {
      content: '.';
    }
    33% {
      content: '..';
    }
    66% {
      content: '...';
    }
  }
`

export const Rate = styled.div`
  font-size: 12px;
  font-weight: 400;
  color: ${({ theme }) => theme.subText};
  margin-left: 4px;
`

export const Detail = styled.div`
  background: ${({ theme }) => theme.secondary};
  border-radius: ${({ theme }) => theme.borderRadius};
  border: 1px solid ${({ theme }) => theme.stroke};
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 12px;
`

export const DetailRow = styled.div`
  display: flex;
  justify-content: space-between;
`
export const DetailLabel = styled.div`
  display: flex;
  align-items: center;
  color: ${({ theme }) => theme.subText};
`
export const DetailRight = styled.div`
  font-weight: 500;
`

export const DetailTitle = styled.div`
  font-size: 12px;
  font-weight: 500;
  line-height: 16px;
  text-transform: uppercase;
  text-align: left;
`
export const ViewRouteTitle = styled.div`
  font-size: 12px;
  font-weight: 400;
  line-height: 16px;
  text-align: right;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
`
export const Divider = styled.div`
  width: 100%;
  height: 1px;
  border-bottom: 1px solid ${({ theme }) => theme.stroke};
`
export const ModalHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`

export const ModalTitle = styled.div`
  cursor: pointer;
  display: flex;
  gap: 0.5rem;
  align-items: center;
  font-size: 1.25rem;
  font-weight: 500;
  :hover {
    opacity: 0.8;
  }

  > svg {
    width: 1.25rem;
    height: 1.25rem;
  }
`

export const ArrowCutoutContainer = styled.div`
  position: relative;
  display: flex;
  justify-content: center;
  height: 0;
  z-index: 10;
`

export const ArrowCutoutRing = styled.div`
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: ${({ theme }) => theme.primary};
  padding: 4px;
  /* Center of 8px gap = +4 from container top; ring half-height = 20 → top = -16 */
  top: -16px;
`

export const ArrowLoadingInner = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 8px;
  background: ${({ theme }) => theme.secondary};
  border: 1px solid rgba(50, 50, 50, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.2s ease;
  z-index: 1;
  color: ${({ theme }) => theme.text};
`

export const ArrowLoadingWrapper = styled.div`
  position: relative;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: inherit;
  border-radius: 8px;
  overflow: visible;
  cursor: pointer;

  &::before {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: 9px;
    background: linear-gradient(
      45deg,
      #f94706,
      #ff7919 30%,
      rgba(0, 0, 0, 0.4) 50%,
      #f94706 70%,
      #ff7919 100%
    );
    background-size: 300% 100%;
    opacity: 0;
    transition: opacity 0.5s ease-out;
    pointer-events: none;
    z-index: 0;
    animation: ${arrowGlare} 1.5s linear infinite;
  }

  &.loading {
    cursor: wait;
  }
  &.loading::before {
    opacity: 1;
  }
  &.loading ${ArrowLoadingInner} {
    border-color: transparent;
  }
  &:not(.loading):hover ${ArrowLoadingInner} {
    border-color: rgba(80, 80, 80, 0.8);
  }

  svg {
    width: 1rem;
    height: 1rem;
  }
`

export const TokenIconWrap = styled.div`
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
`

export const ChainBadge = styled.img`
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 14px;
  height: 14px;
  border-radius: 50% !important;
`

interface OuterProps {
  width?: number
}
export const Outer = styled.div<OuterProps>`
  width: ${({ width }) => `${width || 375}px`};
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
`
