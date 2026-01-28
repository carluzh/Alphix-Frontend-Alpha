/**
 * WebSocket Manager
 *
 * Manages WebSocket connection lifecycle with:
 * - Automatic reconnection with exponential backoff (1s, 2s, 4s, 8s... max 30s)
 * - Channel subscriptions/unsubscriptions
 * - Event routing to handlers
 * - Connection state management
 *
 * Usage:
 * ```ts
 * const ws = new WebSocketManager({
 *   onPositionUpdate: (data) => console.log('Position:', data),
 *   onPoolUpdate: (data) => console.log('Pool:', data),
 * });
 *
 * ws.connect();
 * ws.subscribe(['positions:0x123...', 'pools:0xabc...']);
 * ```
 */

import type {
  WSConfig,
  WSEventHandlers,
  WSConnectionState,
  WSServerMessage,
  WSClientMessage,
  WSPositionData,
  WSPoolData,
  WSSwapData,
  WSPriceData,
} from './types';
import {
  parseChannel,
  isPositionData,
  isPoolData,
  isSwapData,
  isPriceData,
} from './types';

// Default WebSocket URL from environment
// Testnet: ws://34.60.82.34:3001/ws
// Production: wss://api.alphix.fi/ws
const DEFAULT_WS_URL =
  process.env.NEXT_PUBLIC_ALPHIX_WS_URL ||
  'ws://34.60.82.34:3001/ws';

// Default configuration
const DEFAULT_CONFIG: Required<WSConfig> = {
  url: DEFAULT_WS_URL,
  reconnectDelay: 1000,
  maxReconnectDelay: 30000,
  maxReconnectAttempts: Infinity,
  reconnectMultiplier: 2,
};

/**
 * WebSocket connection manager with automatic reconnection
 */
export class WebSocketManager {
  private ws: WebSocket | null = null;
  private config: Required<WSConfig>;
  private handlers: WSEventHandlers;
  private state: WSConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private subscribedChannels = new Set<string>();
  private pendingSubscriptions = new Set<string>();
  private isIntentionalDisconnect = false;

  constructor(handlers: WSEventHandlers = {}, config: WSConfig = {}) {
    this.handlers = handlers;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  /**
   * Get current connection state
   */
  getState(): WSConnectionState {
    return this.state;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.state === 'connected' && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get currently subscribed channels
   */
  getSubscribedChannels(): string[] {
    return Array.from(this.subscribedChannels);
  }

  /**
   * Connect to WebSocket server
   */
  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      console.log('[WS] Already connected or connecting');
      return;
    }

    this.isIntentionalDisconnect = false;
    this.setState('connecting');

    try {
      this.ws = new WebSocket(this.config.url);
      this.setupEventListeners();
    } catch (error) {
      console.error('[WS] Failed to create WebSocket:', error);
      this.handleConnectionError(error as Error);
    }
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    this.isIntentionalDisconnect = true;
    this.clearReconnectTimeout();
    this.reconnectAttempts = 0;

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.subscribedChannels.clear();
    this.pendingSubscriptions.clear();
    this.setState('disconnected');
    this.handlers.onDisconnect?.();
  }

  /**
   * Subscribe to one or more channels
   */
  subscribe(channels: string | string[]): void {
    const channelList = Array.isArray(channels) ? channels : [channels];
    const newChannels = channelList.filter((c) => !this.subscribedChannels.has(c));

    if (newChannels.length === 0) {
      return;
    }

    // Track subscriptions
    newChannels.forEach((c) => {
      this.subscribedChannels.add(c);
      this.pendingSubscriptions.add(c);
    });

    // Send subscription message if connected (one at a time, backend expects singular 'channel')
    if (this.isConnected()) {
      for (const channel of newChannels) {
        this.sendMessage({ type: 'subscribe', channel });
      }
    }
    // If not connected, subscriptions will be sent on connect
  }

  /**
   * Unsubscribe from one or more channels
   */
  unsubscribe(channels: string | string[]): void {
    const channelList = Array.isArray(channels) ? channels : [channels];
    const existingChannels = channelList.filter((c) => this.subscribedChannels.has(c));

    if (existingChannels.length === 0) {
      return;
    }

    // Remove from tracking
    existingChannels.forEach((c) => {
      this.subscribedChannels.delete(c);
      this.pendingSubscriptions.delete(c);
    });

    // Send unsubscribe message if connected (one at a time, backend expects singular 'channel')
    if (this.isConnected()) {
      for (const channel of existingChannels) {
        this.sendMessage({ type: 'unsubscribe', channel });
      }
    }
  }

  /**
   * Update event handlers
   */
  setHandlers(handlers: Partial<WSEventHandlers>): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  /**
   * Force reconnection (resets backoff)
   */
  reconnect(): void {
    this.reconnectAttempts = 0;
    this.clearReconnectTimeout();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.connect();
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  private setState(state: WSConnectionState): void {
    this.state = state;
  }

  private setupEventListeners(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      console.log('[WS] Connected');
      this.setState('connected');
      this.reconnectAttempts = 0;
      this.handlers.onConnect?.();

      // Re-subscribe to all channels on reconnect (one at a time)
      if (this.subscribedChannels.size > 0) {
        const channels = Array.from(this.subscribedChannels);
        console.log('[WS] Re-subscribing to channels:', channels);
        for (const channel of channels) {
          this.sendMessage({ type: 'subscribe', channel });
        }
      }
    };

    this.ws.onclose = (event) => {
      console.log('[WS] Disconnected:', event.code, event.reason);
      this.ws = null;

      if (!this.isIntentionalDisconnect) {
        this.scheduleReconnect();
      } else {
        this.setState('disconnected');
        this.handlers.onDisconnect?.();
      }
    };

    this.ws.onerror = (event) => {
      console.error('[WS] Error:', event);
      this.handlers.onError?.(event);
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(event);
    };
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const message = JSON.parse(event.data) as WSServerMessage;

      // Call generic message handler
      this.handlers.onMessage?.(message);

      // Route by message type
      switch (message.type) {
        case 'data':
          this.handleDataMessage(message);
          break;

        case 'subscribed':
          console.log('[WS] Subscribed to:', message.channels);
          message.channels.forEach((c) => this.pendingSubscriptions.delete(c));
          break;

        case 'unsubscribed':
          console.log('[WS] Unsubscribed from:', message.channels);
          break;

        case 'error':
          console.error('[WS] Server error:', message.error);
          this.handlers.onError?.(new Error(message.error));
          break;
      }
    } catch (error) {
      console.error('[WS] Failed to parse message:', error, event.data);
    }
  }

  private handleDataMessage(message: WSServerMessage): void {
    if (message.type !== 'data') return;

    const { channel, data } = message;

    // Skip system messages (welcome message, etc.)
    if (channel === 'system') {
      console.log('[WS] System message:', data);
      return;
    }

    try {
      const { type } = parseChannel(channel);

      switch (type) {
        case 'positions':
          if (isPositionData(data)) {
            this.handlers.onPositionUpdate?.(data as WSPositionData);
          }
          break;

        case 'pools':
          if (isSwapData(data)) {
            this.handlers.onSwap?.(data as WSSwapData);
          } else if (isPoolData(data)) {
            this.handlers.onPoolUpdate?.(data as WSPoolData);
          }
          break;

        case 'prices':
          if (isPriceData(data)) {
            this.handlers.onPriceUpdate?.(data as WSPriceData);
          }
          break;
      }
    } catch (error) {
      console.error('[WS] Failed to route message:', error, message);
    }
  }

  private sendMessage(message: WSClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[WS] Cannot send message - not connected');
      return;
    }

    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('[WS] Failed to send message:', error);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error('[WS] Max reconnection attempts reached');
      this.setState('disconnected');
      this.handlers.onDisconnect?.();
      return;
    }

    // Calculate delay with exponential backoff
    const delay = Math.min(
      this.config.reconnectDelay * Math.pow(this.config.reconnectMultiplier, this.reconnectAttempts),
      this.config.maxReconnectDelay
    );

    this.reconnectAttempts++;
    this.setState('reconnecting');

    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.handlers.onReconnecting?.(this.reconnectAttempts);

    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  private handleConnectionError(error: Error): void {
    this.handlers.onError?.(error);
    if (!this.isIntentionalDisconnect) {
      this.scheduleReconnect();
    }
  }
}

/**
 * Create a singleton WebSocket manager instance
 *
 * Use this in contexts where you need a shared connection across the app.
 */
let sharedInstance: WebSocketManager | null = null;

export function getSharedWebSocketManager(): WebSocketManager {
  if (!sharedInstance) {
    sharedInstance = new WebSocketManager();
  }
  return sharedInstance;
}

export function resetSharedWebSocketManager(): void {
  if (sharedInstance) {
    sharedInstance.disconnect();
    sharedInstance = null;
  }
}
