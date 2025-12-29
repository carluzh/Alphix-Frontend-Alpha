export type Maybe<T> = T | undefined;
export type InputMaybe<T> = T | undefined;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  /** Large number represented as string to preserve precision */
  BigInt: { input: string; output: string; }
};

export type AllTokenPrices = {
  __typename?: 'AllTokenPrices';
  BTC?: Maybe<Scalars['Float']['output']>;
  ETH?: Maybe<Scalars['Float']['output']>;
  USDC?: Maybe<Scalars['Float']['output']>;
  USDT?: Maybe<Scalars['Float']['output']>;
  aBTC?: Maybe<Scalars['Float']['output']>;
  aETH?: Maybe<Scalars['Float']['output']>;
  aUSDC?: Maybe<Scalars['Float']['output']>;
  aUSDT?: Maybe<Scalars['Float']['output']>;
  timestamp: Scalars['Int']['output'];
};

export type Amount = IAmount & {
  __typename?: 'Amount';
  currency?: Maybe<Currency>;
  id: Scalars['ID']['output'];
  value: Scalars['Float']['output'];
};

export type BuildSwapTxInput = {
  amountIn: Scalars['String']['input'];
  amountOutMin: Scalars['String']['input'];
  deadline: Scalars['Int']['input'];
  recipient: Scalars['String']['input'];
  tokenIn: Scalars['String']['input'];
  tokenOut: Scalars['String']['input'];
};

export type Chain =
  | 'BASE'
  | 'BASE_SEPOLIA';

export type Currency =
  | 'ETH'
  | 'USD';

export type FeeItem = {
  __typename?: 'FeeItem';
  positionId: Scalars['String']['output'];
  token0Fees: Scalars['String']['output'];
  token0FeesUSD?: Maybe<Scalars['Float']['output']>;
  token1Fees: Scalars['String']['output'];
  token1FeesUSD?: Maybe<Scalars['Float']['output']>;
};

export type HistoryDuration =
  | 'DAY'
  | 'HOUR'
  | 'MAX'
  | 'MONTH'
  | 'WEEK'
  | 'YEAR';

export type IAmount = {
  currency?: Maybe<Currency>;
  value: Scalars['Float']['output'];
};

export type IContract = {
  address?: Maybe<Scalars['String']['output']>;
  chain: Chain;
};

export type Mutation = {
  __typename?: 'Mutation';
  buildSwapTransaction?: Maybe<SwapTransaction>;
};


export type MutationBuildSwapTransactionArgs = {
  chain: Chain;
  input: BuildSwapTxInput;
};

export type Pool = {
  __typename?: 'Pool';
  apr?: Maybe<Scalars['Float']['output']>;
  chain: Chain;
  currentPrice?: Maybe<Scalars['String']['output']>;
  dynamicFeeBps?: Maybe<Scalars['Float']['output']>;
  feeTier?: Maybe<Scalars['Int']['output']>;
  fees24hUSD?: Maybe<Scalars['Float']['output']>;
  hook?: Maybe<PoolHook>;
  id: Scalars['ID']['output'];
  liquidity?: Maybe<Scalars['String']['output']>;
  lpFee?: Maybe<Scalars['Int']['output']>;
  poolId: Scalars['String']['output'];
  priceHistory?: Maybe<Array<TimestampedPoolPrice>>;
  protocolFee?: Maybe<Scalars['Int']['output']>;
  protocolVersion: ProtocolVersion;
  sqrtPriceX96?: Maybe<Scalars['String']['output']>;
  tick?: Maybe<Scalars['Int']['output']>;
  tickSpacing: Scalars['Int']['output'];
  ticks?: Maybe<Array<PoolTick>>;
  token0: Token;
  token1: Token;
  tvlUSD?: Maybe<Scalars['Float']['output']>;
  volume24hUSD?: Maybe<Scalars['Float']['output']>;
};


export type PoolPriceHistoryArgs = {
  duration: HistoryDuration;
};


export type PoolTicksArgs = {
  first?: InputMaybe<Scalars['Int']['input']>;
  skip?: InputMaybe<Scalars['Int']['input']>;
};

export type PoolHook = {
  __typename?: 'PoolHook';
  address: Scalars['String']['output'];
  id: Scalars['ID']['output'];
};

export type PoolMetrics = {
  __typename?: 'PoolMetrics';
  apr: Scalars['Float']['output'];
  dynamicFeeBps: Scalars['Float']['output'];
  fees24hUSD: Scalars['Float']['output'];
  poolId: Scalars['String']['output'];
  tvlUSD: Scalars['Float']['output'];
  volume24hUSD: Scalars['Float']['output'];
};

export type PoolState = {
  __typename?: 'PoolState';
  chain: Chain;
  currentPoolTick: Scalars['Int']['output'];
  currentPrice: Scalars['String']['output'];
  liquidity: Scalars['String']['output'];
  lpFee: Scalars['Int']['output'];
  poolId: Scalars['String']['output'];
  protocolFee: Scalars['Int']['output'];
  sqrtPriceX96: Scalars['String']['output'];
  tick: Scalars['Int']['output'];
};

export type PoolTick = {
  __typename?: 'PoolTick';
  id: Scalars['ID']['output'];
  liquidityGross: Scalars['String']['output'];
  liquidityNet: Scalars['String']['output'];
  price0?: Maybe<Scalars['String']['output']>;
  price1?: Maybe<Scalars['String']['output']>;
  tickIdx: Scalars['Int']['output'];
};

export type Position = {
  __typename?: 'Position';
  ageSeconds: Scalars['Int']['output'];
  blockTimestamp: Scalars['Int']['output'];
  chain: Chain;
  feesUSD?: Maybe<Scalars['Float']['output']>;
  id: Scalars['ID']['output'];
  isInRange: Scalars['Boolean']['output'];
  lastTimestamp: Scalars['Int']['output'];
  liquidity: Scalars['String']['output'];
  owner: Scalars['String']['output'];
  pool?: Maybe<Pool>;
  poolId: Scalars['String']['output'];
  positionId: Scalars['String']['output'];
  tickLower: Scalars['Int']['output'];
  tickUpper: Scalars['Int']['output'];
  token0: PositionToken;
  token0UncollectedFees?: Maybe<Scalars['String']['output']>;
  token1: PositionToken;
  token1UncollectedFees?: Maybe<Scalars['String']['output']>;
  valueUSD?: Maybe<Scalars['Float']['output']>;
};

export type PositionToken = {
  __typename?: 'PositionToken';
  address: Scalars['String']['output'];
  amount: Scalars['String']['output'];
  rawAmount: Scalars['String']['output'];
  symbol: Scalars['String']['output'];
};

export type ProtocolVersion =
  | 'V4';

export type Query = {
  __typename?: 'Query';
  _health?: Maybe<Scalars['String']['output']>;
  pool?: Maybe<Pool>;
  poolMetrics?: Maybe<PoolMetrics>;
  poolPriceHistory: Array<TimestampedPoolPrice>;
  poolState?: Maybe<PoolState>;
  poolTicks: Array<PoolTick>;
  pools: Array<Pool>;
  position?: Maybe<Position>;
  positionFees?: Maybe<FeeItem>;
  swapQuote?: Maybe<SwapQuote>;
  token?: Maybe<Token>;
  tokenPrices: AllTokenPrices;
  userPositions: Array<Position>;
};


export type QueryPoolArgs = {
  chain: Chain;
  poolId: Scalars['String']['input'];
};


export type QueryPoolMetricsArgs = {
  chain: Chain;
  poolId: Scalars['String']['input'];
};


export type QueryPoolPriceHistoryArgs = {
  chain: Chain;
  duration: HistoryDuration;
  poolId: Scalars['String']['input'];
};


export type QueryPoolStateArgs = {
  chain: Chain;
  poolId: Scalars['String']['input'];
};


export type QueryPoolTicksArgs = {
  chain: Chain;
  first?: InputMaybe<Scalars['Int']['input']>;
  poolId: Scalars['String']['input'];
  skip?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryPoolsArgs = {
  chain: Chain;
  first?: InputMaybe<Scalars['Int']['input']>;
  skip?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryPositionArgs = {
  chain: Chain;
  positionId: Scalars['String']['input'];
};


export type QueryPositionFeesArgs = {
  chain: Chain;
  positionId: Scalars['String']['input'];
};


export type QuerySwapQuoteArgs = {
  chain: Chain;
  input: SwapQuoteInput;
};


export type QueryTokenArgs = {
  address?: InputMaybe<Scalars['String']['input']>;
  chain: Chain;
};


export type QueryTokenPricesArgs = {
  chain: Chain;
};


export type QueryUserPositionsArgs = {
  chain: Chain;
  owner: Scalars['String']['input'];
};

export type SwapQuote = {
  __typename?: 'SwapQuote';
  amountIn: Scalars['String']['output'];
  amountOut: Scalars['String']['output'];
  fees: Array<Scalars['Int']['output']>;
  minimumReceived?: Maybe<Scalars['String']['output']>;
  path: Array<Scalars['String']['output']>;
  priceImpact?: Maybe<Scalars['Float']['output']>;
};

export type SwapQuoteInput = {
  amount: Scalars['String']['input'];
  exactIn: Scalars['Boolean']['input'];
  slippageTolerance?: InputMaybe<Scalars['Float']['input']>;
  tokenIn: Scalars['String']['input'];
  tokenOut: Scalars['String']['input'];
};

export type SwapTransaction = {
  __typename?: 'SwapTransaction';
  data: Scalars['String']['output'];
  gasLimit?: Maybe<Scalars['String']['output']>;
  to: Scalars['String']['output'];
  value: Scalars['String']['output'];
};

export type TicksInput = {
  first?: InputMaybe<Scalars['Int']['input']>;
  poolId: Scalars['String']['input'];
  skip?: InputMaybe<Scalars['Int']['input']>;
};

export type TimestampedAmount = IAmount & {
  __typename?: 'TimestampedAmount';
  currency?: Maybe<Currency>;
  id: Scalars['ID']['output'];
  timestamp: Scalars['Int']['output'];
  value: Scalars['Float']['output'];
};

export type TimestampedPoolPrice = {
  __typename?: 'TimestampedPoolPrice';
  id: Scalars['ID']['output'];
  timestamp: Scalars['Int']['output'];
  token0Price: Scalars['Float']['output'];
  token1Price: Scalars['Float']['output'];
};

export type Token = IContract & {
  __typename?: 'Token';
  address?: Maybe<Scalars['String']['output']>;
  chain: Chain;
  decimals: Scalars['Int']['output'];
  id: Scalars['ID']['output'];
  name?: Maybe<Scalars['String']['output']>;
  priceChange24h?: Maybe<Scalars['Float']['output']>;
  priceUSD?: Maybe<Scalars['Float']['output']>;
  symbol: Scalars['String']['output'];
};

export type TokenPrice = {
  __typename?: 'TokenPrice';
  priceChange24h?: Maybe<Scalars['Float']['output']>;
  priceUSD: Scalars['Float']['output'];
  symbol: Scalars['String']['output'];
  timestamp: Scalars['Int']['output'];
};
