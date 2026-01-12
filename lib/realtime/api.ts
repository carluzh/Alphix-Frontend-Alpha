/**
 * SSE API Utilities
 *
 * Functions for interacting with the backend SSE endpoints.
 */

const BACKEND_URL = process.env.NEXT_PUBLIC_ALPHIX_BACKEND_URL || 'http://localhost:3001';

interface StreamStats {
  totalConnections: number;
  uniqueWallets: number;
  timestamp: string;
}

/**
 * Get current SSE stream statistics
 */
export async function getStreamStats(): Promise<StreamStats | null> {
  try {
    const response = await fetch(`${BACKEND_URL}/stream/stats`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('[SSE] getStreamStats failed:', error);
    return null;
  }
}
