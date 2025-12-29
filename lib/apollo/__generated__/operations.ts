import * as Types from './schema-types';

export type TokenFieldsFragment = (
  { __typename?: 'Token' }
  & Pick<
    Types.Token,
    | 'id'
    | 'chain'
    | 'address'
    | 'symbol'
    | 'name'
    | 'decimals'
    | 'priceUSD'
    | 'priceChange24h'
  >
);

export type PositionTokenFieldsFragment = (
  { __typename?: 'PositionToken' }
  & Pick<
    Types.PositionToken,
    | 'address'
    | 'symbol'
    | 'amount'
    | 'rawAmount'
  >
);

export type PoolTickFieldsFragment = (
  { __typename?: 'PoolTick' }
  & Pick<
    Types.PoolTick,
    | 'id'
    | 'tickIdx'
    | 'liquidityGross'
    | 'liquidityNet'
    | 'price0'
    | 'price1'
  >
);

export type PoolStateFieldsFragment = (
  { __typename?: 'PoolState' }
  & Pick<
    Types.PoolState,
    | 'chain'
    | 'poolId'
    | 'sqrtPriceX96'
    | 'tick'
    | 'liquidity'
    | 'protocolFee'
    | 'lpFee'
    | 'currentPrice'
    | 'currentPoolTick'
  >
);

export type PoolFieldsFragment = (
  { __typename?: 'Pool' }
  & Pick<
    Types.Pool,
    | 'id'
    | 'chain'
    | 'poolId'
    | 'protocolVersion'
    | 'feeTier'
    | 'tickSpacing'
    | 'sqrtPriceX96'
    | 'tick'
    | 'liquidity'
    | 'currentPrice'
    | 'protocolFee'
    | 'lpFee'
    | 'tvlUSD'
    | 'volume24hUSD'
    | 'fees24hUSD'
    | 'dynamicFeeBps'
    | 'apr'
  >
  & {
    token0: (
      { __typename?: 'Token' }
      & Pick<
        Types.Token,
        | 'id'
        | 'chain'
        | 'address'
        | 'symbol'
        | 'name'
        | 'decimals'
        | 'priceUSD'
        | 'priceChange24h'
      >
    ),
    token1: (
      { __typename?: 'Token' }
      & Pick<
        Types.Token,
        | 'id'
        | 'chain'
        | 'address'
        | 'symbol'
        | 'name'
        | 'decimals'
        | 'priceUSD'
        | 'priceChange24h'
      >
    ),
    hook?: Types.Maybe<(
      { __typename?: 'PoolHook' }
      & Pick<Types.PoolHook, 'id' | 'address'>
    )>,
  }
);

export type PositionFieldsFragment = (
  { __typename?: 'Position' }
  & Pick<
    Types.Position,
    | 'id'
    | 'chain'
    | 'positionId'
    | 'owner'
    | 'poolId'
    | 'tickLower'
    | 'tickUpper'
    | 'liquidity'
    | 'ageSeconds'
    | 'blockTimestamp'
    | 'lastTimestamp'
    | 'isInRange'
    | 'token0UncollectedFees'
    | 'token1UncollectedFees'
    | 'valueUSD'
    | 'feesUSD'
  >
  & {
    token0: (
      { __typename?: 'PositionToken' }
      & Pick<
        Types.PositionToken,
        | 'address'
        | 'symbol'
        | 'amount'
        | 'rawAmount'
      >
    ),
    token1: (
      { __typename?: 'PositionToken' }
      & Pick<
        Types.PositionToken,
        | 'address'
        | 'symbol'
        | 'amount'
        | 'rawAmount'
      >
    ),
  }
);

export type TimestampedPoolPriceFieldsFragment = (
  { __typename?: 'TimestampedPoolPrice' }
  & Pick<
    Types.TimestampedPoolPrice,
    | 'id'
    | 'timestamp'
    | 'token0Price'
    | 'token1Price'
  >
);

export type GetPoolStateQueryVariables = Types.Exact<{
  chain: Types.Chain;
  poolId: Types.Scalars['String']['input'];
}>;


export type GetPoolStateQuery = (
  { __typename?: 'Query' }
  & { poolState?: Types.Maybe<(
    { __typename?: 'PoolState' }
    & Pick<
      Types.PoolState,
      | 'chain'
      | 'poolId'
      | 'sqrtPriceX96'
      | 'tick'
      | 'liquidity'
      | 'protocolFee'
      | 'lpFee'
      | 'currentPrice'
      | 'currentPoolTick'
    >
  )> }
);

export type GetPoolQueryVariables = Types.Exact<{
  chain: Types.Chain;
  poolId: Types.Scalars['String']['input'];
}>;


export type GetPoolQuery = (
  { __typename?: 'Query' }
  & { pool?: Types.Maybe<(
    { __typename?: 'Pool' }
    & Pick<
      Types.Pool,
      | 'id'
      | 'chain'
      | 'poolId'
      | 'protocolVersion'
      | 'sqrtPriceX96'
      | 'tick'
      | 'liquidity'
      | 'currentPrice'
      | 'tvlUSD'
      | 'volume24hUSD'
      | 'apr'
    >
  )> }
);

export type GetPoolMetricsQueryVariables = Types.Exact<{
  chain: Types.Chain;
  poolId: Types.Scalars['String']['input'];
}>;


export type GetPoolMetricsQuery = (
  { __typename?: 'Query' }
  & { poolMetrics?: Types.Maybe<(
    { __typename?: 'PoolMetrics' }
    & Pick<
      Types.PoolMetrics,
      | 'poolId'
      | 'tvlUSD'
      | 'volume24hUSD'
      | 'fees24hUSD'
      | 'dynamicFeeBps'
      | 'apr'
    >
  )> }
);

export type GetPoolPriceHistoryQueryVariables = Types.Exact<{
  chain: Types.Chain;
  poolId: Types.Scalars['String']['input'];
  duration: Types.HistoryDuration;
}>;


export type GetPoolPriceHistoryQuery = (
  { __typename?: 'Query' }
  & { poolPriceHistory: Array<(
    { __typename?: 'TimestampedPoolPrice' }
    & Pick<
      Types.TimestampedPoolPrice,
      | 'id'
      | 'timestamp'
      | 'token0Price'
      | 'token1Price'
    >
  )> }
);

export type GetPoolTicksQueryVariables = Types.Exact<{
  chain: Types.Chain;
  poolId: Types.Scalars['String']['input'];
  skip?: Types.InputMaybe<Types.Scalars['Int']['input']>;
  first?: Types.InputMaybe<Types.Scalars['Int']['input']>;
}>;


export type GetPoolTicksQuery = (
  { __typename?: 'Query' }
  & { poolTicks: Array<(
    { __typename?: 'PoolTick' }
    & Pick<
      Types.PoolTick,
      | 'id'
      | 'tickIdx'
      | 'liquidityGross'
      | 'liquidityNet'
      | 'price0'
      | 'price1'
    >
  )> }
);

export type GetUserPositionsQueryVariables = Types.Exact<{
  chain: Types.Chain;
  owner: Types.Scalars['String']['input'];
}>;


export type GetUserPositionsQuery = (
  { __typename?: 'Query' }
  & { userPositions: Array<(
    { __typename?: 'Position' }
    & Pick<
      Types.Position,
      | 'id'
      | 'chain'
      | 'positionId'
      | 'owner'
      | 'poolId'
      | 'tickLower'
      | 'tickUpper'
      | 'liquidity'
      | 'ageSeconds'
      | 'blockTimestamp'
      | 'lastTimestamp'
      | 'isInRange'
      | 'token0UncollectedFees'
      | 'token1UncollectedFees'
    >
    & {
      token0: (
        { __typename?: 'PositionToken' }
        & Pick<
          Types.PositionToken,
          | 'address'
          | 'symbol'
          | 'amount'
          | 'rawAmount'
        >
      ),
      token1: (
        { __typename?: 'PositionToken' }
        & Pick<
          Types.PositionToken,
          | 'address'
          | 'symbol'
          | 'amount'
          | 'rawAmount'
        >
      ),
    }
  )> }
);

export type GetPositionQueryVariables = Types.Exact<{
  chain: Types.Chain;
  positionId: Types.Scalars['String']['input'];
}>;


export type GetPositionQuery = (
  { __typename?: 'Query' }
  & { position?: Types.Maybe<(
    { __typename?: 'Position' }
    & Pick<
      Types.Position,
      | 'id'
      | 'chain'
      | 'positionId'
      | 'owner'
      | 'poolId'
      | 'tickLower'
      | 'tickUpper'
      | 'liquidity'
      | 'ageSeconds'
      | 'blockTimestamp'
      | 'lastTimestamp'
      | 'isInRange'
      | 'token0UncollectedFees'
      | 'token1UncollectedFees'
      | 'valueUSD'
      | 'feesUSD'
    >
    & {
      token0: (
        { __typename?: 'PositionToken' }
        & Pick<
          Types.PositionToken,
          | 'address'
          | 'symbol'
          | 'amount'
          | 'rawAmount'
        >
      ),
      token1: (
        { __typename?: 'PositionToken' }
        & Pick<
          Types.PositionToken,
          | 'address'
          | 'symbol'
          | 'amount'
          | 'rawAmount'
        >
      ),
    }
  )> }
);

export type GetPositionFeesQueryVariables = Types.Exact<{
  chain: Types.Chain;
  positionId: Types.Scalars['String']['input'];
}>;


export type GetPositionFeesQuery = (
  { __typename?: 'Query' }
  & { positionFees?: Types.Maybe<(
    { __typename?: 'FeeItem' }
    & Pick<
      Types.FeeItem,
      | 'positionId'
      | 'token0Fees'
      | 'token1Fees'
      | 'token0FeesUSD'
      | 'token1FeesUSD'
    >
  )> }
);

export type GetTokenPricesQueryVariables = Types.Exact<{
  chain: Types.Chain;
}>;


export type GetTokenPricesQuery = (
  { __typename?: 'Query' }
  & { tokenPrices: (
    { __typename?: 'AllTokenPrices' }
    & Pick<
      Types.AllTokenPrices,
      | 'BTC'
      | 'aBTC'
      | 'ETH'
      | 'aETH'
      | 'USDC'
      | 'aUSDC'
      | 'USDT'
      | 'aUSDT'
      | 'timestamp'
    >
  ) }
);

export type GetTokenQueryVariables = Types.Exact<{
  chain: Types.Chain;
  address?: Types.InputMaybe<Types.Scalars['String']['input']>;
}>;


export type GetTokenQuery = (
  { __typename?: 'Query' }
  & { token?: Types.Maybe<(
    { __typename?: 'Token' }
    & Pick<
      Types.Token,
      | 'id'
      | 'chain'
      | 'address'
      | 'symbol'
      | 'name'
      | 'decimals'
      | 'priceUSD'
      | 'priceChange24h'
    >
  )> }
);
