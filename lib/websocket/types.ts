/**
 * WebSocket Types
 *
 * Type definitions for the Alphix real-time WebSocket API.
 * Data is pushed automatically when on-chain events occur via Goldsky subgraph webhooks.
 *
 * Channels:
 * - positions:{address} - Position updates for a wallet
 * - pools:{poolId} - Pool state changes and swaps
 * - prices - All token price updates
 *
 * Server: wss://api.alphix.it/ws (production) | ws://localhost:3001/ws (dev)
 */

// =============================================================================
// CLIENT → SERVER MESSAGES
// =============================================================================

/**
 * Subscribe to a channel
 */
export interface WSSubscribeMessage {
  type: 'subscribe';
  channel: string;
}

/**
 * Unsubscribe from a channel
 */
export interface WSUnsubscribeMessage {
  type: 'unsubscribe';
  channel: string;
}

/**
 * All possible client-to-server message types
 */
export type WSClientMessage = WSSubscribeMessage | WSUnsubscribeMessage;

// =============================================================================
// SERVER → CLIENT MESSAGES
// =============================================================================

/**
 * Data message containing channel updates
 */
export interface WSDataMessage<T = unknown> {
  type: 'data';
  channel: string;
  data: T;
  timestamp: number;
}

/**
 * Subscription confirmation
 * Server may send either 'channel' (singular) or 'channels' (array)
 */
export interface WSSubscribedMessage {
  type: 'subscribed';
  channel?: string;
  channels?: string[];
  timestamp: number;
}

/**
 * Unsubscription confirmation
 * Server may send either 'channel' (singular) or 'channels' (array)
 */
export interface WSUnsubscribedMessage {
  type: 'unsubscribed';
  channel?: string;
  channels?: string[];
  timestamp: number;
}

/**
 * Error message
 */
export interface WSErrorMessage {
  type: 'error';
  error: string;
  timestamp: number;
}

/**
 * System message (e.g., welcome message on connect)
 */
export interface WSSystemMessage {
  type: 'data';
  channel: 'system';
  data: {
    message: string;
  };
  timestamp: number;
}

/**
 * All possible server-to-client message types
 */
export type WSServerMessage =
  | WSDataMessage
  | WSSubscribedMessage
  | WSUnsubscribedMessage
  | WSErrorMessage
  | WSSystemMessage;

// =============================================================================
// POSITION DATA
// =============================================================================

/**
 * Position event types
 */
export type PositionEventType = 'position_insert' | 'position_update' | 'position_delete';

/**
 * Position update payload from WebSocket
 *
 * Sent on: positions:{address} channel
 * Triggered by: Deposits, withdrawals, share changes
 */
export interface WSPositionData {
  event: PositionEventType;
  /** Position ID: "{hookAddress}-{userAddress}" */
  positionId: string;
  /** Owner wallet address */
  owner: string;
  /** Pool ID (bytes32 hex) */
  poolId: string;
  /** Hook contract address */
  hookAddress: string;
  /** User's share balance (string for bigint) */
  shareBalance: string;

  // Enriched data (computed by backend)
  /** Token0 amount (decimal adjusted) */
  amount0: number;
  /** Token1 amount (decimal adjusted) */
  amount1: number;
  /** Current USD value */
  valueUsd: number;
  /** Total deposited - withdrawn (USD) */
  netDepositUsd: number;

  // Deposit tracking
  totalAmount0In: string;
  totalAmount1In: string;
  totalAmount0Out: string;
  totalAmount1Out: string;

  // Metadata
  type: 'unified-yield';
  /** Unix timestamp of position creation */
  createdAt: number;
  /** Event timestamp (ms) */
  timestamp: number;
}

// =============================================================================
// POOL METRICS DATA (pools:metrics channel)
// =============================================================================

/**
 * Pool metrics payload from WebSocket
 *
 * Sent on: pools:metrics channel
 * Triggered by: On subscribe (array of all pools) + after swaps (single pool)
 */
export interface WSPoolData {
  /** Pool ID (bytes32 hex) */
  poolId: string;
  /** Pool name (e.g., "USDC/USDT") */
  name: string;
  /** Network identifier */
  network: string;
  /** TVL in USD */
  tvlUsd: number;
  /** 24h volume in USD (from poolDayDatas) */
  volume24hUsd: number;
  /** 24h fees in USD (from poolDayDatas) */
  fees24hUsd: number;
  /** LP fee in basis points */
  lpFee: number;
  /** Token0 USD price */
  token0Price: number;
  /** Token1 USD price */
  token1Price: number;
  /** Event timestamp (ms) */
  timestamp: number;
}

// =============================================================================
// POOL STATE DATA (pools:{poolId} channel - future use)
// =============================================================================

/**
 * Pool event types (non-swap)
 */
export type PoolEventType = 'pool_insert' | 'pool_update';

/**
 * Swap event payload from WebSocket
 *
 * Sent on: pools:{poolId} channel
 * Triggered by: Swap transactions
 */
export interface WSSwapData {
  event: 'swap';
  /** Swap ID */
  swapId: string;
  /** Pool ID */
  poolId: string;
  /** Sender address */
  sender: string;
  /** Recipient address */
  recipient: string;
  /** Amount of token0 (positive = in, negative = out) */
  amount0: string;
  /** Amount of token1 (positive = in, negative = out) */
  amount1: string;
  /** USD value of swap */
  amountUsd: number;
  /** New sqrtPriceX96 after swap */
  sqrtPriceX96: string;
  /** New tick after swap */
  tick: number;
  /** Event timestamp (ms) */
  timestamp: number;
}

/**
 * Combined pool channel data (can be pool update or swap)
 */
export type WSPoolChannelData = WSPoolData | WSSwapData;

// =============================================================================
// PRICE DATA
// =============================================================================

/**
 * Price update payload from WebSocket
 *
 * Sent on: prices channel
 * Triggered by: Pool tick changes
 */
export interface WSPriceData {
  event: 'price_update';
  /** Pool ID that triggered the price update */
  poolId: string;
  /** Current tick */
  tick: number;
  /** Current sqrtPriceX96 */
  sqrtPriceX96: string;
  /** Token0 USD price */
  token0Price: number;
  /** Token1 USD price */
  token1Price: number;
  /** Event timestamp (ms) */
  timestamp: number;
}

// =============================================================================
// CHANNEL UTILITIES
// =============================================================================

/**
 * Channel type identifiers
 */
export type ChannelType = 'positions' | 'pools' | 'prices' | 'system';

/**
 * Create a position channel for an address
 */
export function createPositionChannel(address: string): string {
  return `positions:${address.toLowerCase()}`;
}

/**
 * Create a pool channel for a pool ID
 */
export function createPoolChannel(poolId: string): string {
  return `pools:${poolId.toLowerCase()}`;
}

/**
 * Parse a channel string to extract type and identifier
 */
export function parseChannel(channel: string): { type: ChannelType; id?: string } {
  if (channel === 'prices') {
    return { type: 'prices' };
  }
  if (channel === 'system') {
    return { type: 'system' };
  }
  if (channel.startsWith('positions:')) {
    return { type: 'positions', id: channel.slice(10) };
  }
  if (channel.startsWith('pools:')) {
    return { type: 'pools', id: channel.slice(6) };
  }
  throw new Error(`Unknown channel format: ${channel}`);
}

// =============================================================================
// TYPE GUARDS
// =============================================================================

/**
 * Type guard for position data
 */
export function isPositionData(data: unknown): data is WSPositionData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'event' in data &&
    typeof (data as WSPositionData).event === 'string' &&
    (data as WSPositionData).event.startsWith('position_')
  );
}

/**
 * Type guard for pool metrics data (from pools:metrics channel)
 */
export function isPoolData(data: unknown): data is WSPoolData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'poolId' in data &&
    'tvlUsd' in data &&
    typeof (data as WSPoolData).poolId === 'string'
  );
}

/**
 * Type guard for swap data
 */
export function isSwapData(data: unknown): data is WSSwapData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'event' in data &&
    (data as WSSwapData).event === 'swap'
  );
}

/**
 * Type guard for price data
 */
export function isPriceData(data: unknown): data is WSPriceData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'event' in data &&
    (data as WSPriceData).event === 'price_update'
  );
}

// =============================================================================
// CONNECTION STATE
// =============================================================================

/**
 * WebSocket connection states
 */
export type WSConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/**
 * WebSocket manager configuration
 */
export interface WSConfig {
  /** WebSocket URL (defaults to env or localhost) */
  url?: string;
  /** Initial reconnect delay in ms (default: 1000) */
  reconnectDelay?: number;
  /** Maximum reconnect delay in ms (default: 30000) */
  maxReconnectDelay?: number;
  /** Maximum reconnection attempts (default: Infinity) */
  maxReconnectAttempts?: number;
  /** Reconnect multiplier for exponential backoff (default: 2) */
  reconnectMultiplier?: number;
}

/**
 * Event handlers for WebSocket manager
 */
export interface WSEventHandlers {
  onConnect?: () => void;
  onDisconnect?: () => void;
  onReconnecting?: (attempt: number) => void;
  onError?: (error: Event | Error) => void;
  onPositionUpdate?: (data: WSPositionData) => void;
  onPoolUpdate?: (data: WSPoolData) => void;
  onSwap?: (data: WSSwapData) => void;
  onPriceUpdate?: (data: WSPriceData) => void;
  onMessage?: (message: WSServerMessage) => void;
}
