/**
 * Deterministic Avatar Component
 * Exact Uniswap Unicon implementation for identical profile images
 */

import { Icons } from './unicon-svgs'
import { getUniconsDeterministicHash, getUniconColors } from './unicon-utils'

interface DeterministicAvatarProps {
  address: string;
  size: number;
  className?: string;
  isDark?: boolean;
}

/**
 * DeterministicAvatar - Exact Uniswap Unicon implementation
 * Generates identical avatar to Uniswap based on wallet address
 */
export function DeterministicAvatar({
  address,
  size,
  className,
  isDark = true,
}: DeterministicAvatarProps) {
  if (!address || !address.startsWith('0x') || address.length < 42) {
    return null
  }

  const hashValue = getUniconsDeterministicHash(address)
  const { color } = getUniconColors(address, isDark)

  const iconKeys = Object.keys(Icons)
  const iconIndex = Math.abs(Number(hashValue)) % iconKeys.length
  const selectedIconKey = iconKeys[iconIndex] as keyof typeof Icons
  const selectedIconPaths = Icons[selectedIconKey]

  const ORIGINAL_CONTAINER_SIZE = 48
  const scaleValue = size / ORIGINAL_CONTAINER_SIZE / 1.5
  const scaledSVGSize = ORIGINAL_CONTAINER_SIZE * scaleValue
  const translateX = (size - scaledSVGSize) / 2
  const translateY = (size - scaledSVGSize) / 2

  // Background opacity: 29 for dark mode, 1F for light mode (hex)
  const bgOpacity = isDark ? '29' : '1F'

  return (
    <svg
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <g style={{ transformOrigin: 'center center' }}>
        <rect x={0} y={0} width={size} height={size} rx={size * 0.2} ry={size * 0.2} fill={color + bgOpacity} />
        <g transform={`translate(${translateX}, ${translateY}) scale(${scaleValue})`}>
          {selectedIconPaths?.map((pathData: string, index: number) => (
            <path
              key={index}
              clipRule="evenodd"
              d={pathData}
              fill={color}
              fillRule="evenodd"
            />
          ))}
        </g>
      </g>
    </svg>
  )
}
