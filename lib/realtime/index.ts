/**
 * Realtime SSE Module
 *
 * Modular SSE infrastructure for real-time data updates.
 *
 * Currently supports:
 * - Position snapshots
 *
 * Future channels (add as implemented on backend):
 * - Points
 * - Yield for Positions
 * - Aave 4626 Yield
 * - Referrals
 *
 * @example Setup in AppProviders:
 * ```tsx
 * import { SSEProvider } from '@/lib/realtime';
 *
 * export default function AppProviders({ children }) {
 *   return (
 *     <SSEProvider>
 *       {children}
 *     </SSEProvider>
 *   );
 * }
 * ```
 *
 * @example Consuming position snapshots:
 * ```tsx
 * import { usePositionSnapshots } from '@/lib/realtime';
 *
 * function PositionChart({ positionId }) {
 *   const { isConnected, getPositionHistory, totalValueUsd } = usePositionSnapshots({
 *     positionIds: [positionId],
 *   });
 *
 *   const history = getPositionHistory(positionId);
 *   // Render chart with history...
 * }
 * ```
 *
 */

// Types
export type {
  SSEConnectionStatus,
  SSEEventType,
  SSEEventMap,
  SSEHandlers,
  PositionSnapshotPayload,
  PointsPayload,
  YieldPayload,
  AaveYieldPayload,
  ReferralPayload,
} from './types';

// Provider
export { SSEProvider, useSSEContext } from './SSEProvider';

// Hooks
export { usePositionSnapshots } from './hooks/usePositionSnapshots';

// Core hook (for advanced use cases)
export { useSSE } from './useSSE';
