/**
 * Pending Transaction Types
 *
 * Type definitions for the transaction watcher system.
 * Follows Uniswap's PendingTransactionDetails pattern.
 *
 * @see interface/packages/uniswap/src/features/transactions/types/transactionDetails.ts
 */

export enum PendingTransactionType {
  // Liquidity operations
  AddLiquidity = 'ADD_LIQUIDITY',
  IncreaseLiquidity = 'INCREASE_LIQUIDITY',
  DecreaseLiquidity = 'DECREASE_LIQUIDITY',
  CollectFees = 'COLLECT_FEES',
  RemovePosition = 'REMOVE_POSITION',

  // Swap operations
  Swap = 'SWAP',
  ZapSwap = 'ZAP_SWAP',

  // Approval operations
  Approve = 'APPROVE',
}

export enum PendingTransactionStatus {
  Pending = 'PENDING',
  Confirmed = 'CONFIRMED',
  Failed = 'FAILED',
}

export interface TransactionTokenInfo {
  symbol: string;
  address: string;
  amount?: string;
  decimals?: number;
}

export interface PendingTransactionDetails {
  /** Unique transaction hash */
  hash: `0x${string}`;

  /** Type of transaction */
  type: PendingTransactionType;

  /** Current status */
  status: PendingTransactionStatus;

  /** Chain ID where transaction was submitted */
  chainId: number;

  /** User address that initiated the transaction */
  from: string;

  /** Timestamp when transaction was submitted */
  addedTime: number;

  /** Token 0 info (for LP operations) */
  token0?: TransactionTokenInfo;

  /** Token 1 info (for LP operations) */
  token1?: TransactionTokenInfo;

  /** Pool ID (for LP operations) */
  poolId?: string;

  /** Position ID (for existing position operations) */
  positionId?: string;

  /** Tick bounds (for LP operations) */
  tickLower?: number;
  tickUpper?: number;

  /** TVL delta for optimistic updates */
  tvlDelta?: number;

  /** Volume delta for optimistic updates (zap/swap) */
  volumeDelta?: number;

  /** Block number when confirmed */
  blockNumber?: bigint;

  /** Error message if failed */
  errorMessage?: string;
}

export interface TransactionUpdate {
  hash: `0x${string}`;
  status: PendingTransactionStatus;
  blockNumber?: bigint;
  errorMessage?: string;
}

/**
 * Currencies that need balance updates after this transaction
 */
export interface CurrencyUpdate {
  chainId: number;
  address: string;
  symbol: string;
}

/**
 * Get currencies that should be updated after a transaction completes
 */
export function getCurrenciesFromTransaction(
  tx: PendingTransactionDetails
): CurrencyUpdate[] {
  const currencies: CurrencyUpdate[] = [];

  if (tx.token0?.address) {
    currencies.push({
      chainId: tx.chainId,
      address: tx.token0.address,
      symbol: tx.token0.symbol,
    });
  }

  if (tx.token1?.address) {
    currencies.push({
      chainId: tx.chainId,
      address: tx.token1.address,
      symbol: tx.token1.symbol,
    });
  }

  return currencies;
}
