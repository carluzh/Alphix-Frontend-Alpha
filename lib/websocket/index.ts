/**
 * WebSocket Module
 *
 * Real-time pool metrics via WebSocket with REST fallback.
 *
 * Architecture:
 * 1. Connect to WebSocket on app load (auto-subscribes to pools:metrics)
 * 2. Fetch initial data via REST from api.alphix.fi
 * 3. Apply WebSocket updates on top of initial data
 * 4. Fall back to REST polling (45s) when WebSocket disconnected
 *
 * Data Flow:
 * - Initial: REST api.alphix.fi/pools/metrics → poolsMap
 * - Updates: WebSocket pools:metrics channel → poolsMap
 * - All TVL/Volume/Fees data comes from backend only (no subgraph queries)
 *
 * @example Setup in AppProviders:
 * ```tsx
 * import { WebSocketProvider } from '@/lib/websocket';
 *
 * function AppProviders({ children }) {
 *   return (
 *     <WebSocketProvider>
 *       {children}
 *     </WebSocketProvider>
 *   );
 * }
 * ```
 *
 * @example All pools (list page):
 * ```tsx
 * import { useWSPools } from '@/lib/websocket';
 *
 * function PoolsTable() {
 *   const { pools, isLoading, isConnected } = useWSPools();
 *
 *   return (
 *     <table>
 *       {pools.map(pool => (
 *         <tr key={pool.poolId}>
 *           <td>{pool.name}</td>
 *           <td>${pool.tvlUsd.toLocaleString()}</td>
 *         </tr>
 *       ))}
 *     </table>
 *   );
 * }
 * ```
 *
 * @example Single pool (detail page):
 * ```tsx
 * import { useWSPool } from '@/lib/websocket';
 *
 * function PoolStats({ poolId }) {
 *   const { pool, isConnected } = useWSPool(poolId);
 *
 *   return (
 *     <div>
 *       <p>TVL: ${pool?.tvlUsd?.toLocaleString()}</p>
 *       <p>Volume 24h: ${pool?.volume24hUsd?.toLocaleString()}</p>
 *     </div>
 *   );
 * }
 * ```
 */

// Types
export type {
  // Server messages
  WSServerMessage,
  // Data payloads
  WSPoolData,
  // Configuration
  WSConnectionState,
  WSConfig,
} from './types';

// Type guards and utilities
export { isPoolData } from './types';

// Manager (for advanced use cases)
export {
  WebSocketManager,
  getSharedWebSocketManager,
  resetSharedWebSocketManager,
} from './WebSocketManager';

// Provider
export { WebSocketProvider, useWebSocket, useWebSocketOptional } from './WebSocketProvider';

// Hooks
export { useWSPool, type PoolData } from './hooks/useWSPool';
export { useWSPools } from './hooks/useWSPools';
