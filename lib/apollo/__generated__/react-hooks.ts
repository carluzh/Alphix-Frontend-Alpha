import * as Types from './operations';

import { gql } from '@apollo/client';
import * as Apollo from '@apollo/client';
const defaultOptions = {} as const;
export const PoolTickFieldsFragmentDoc = gql`
    fragment PoolTickFields on PoolTick {
  id
  tickIdx
  liquidityGross
  liquidityNet
  price0
  price1
}
    `;
export const PoolStateFieldsFragmentDoc = gql`
    fragment PoolStateFields on PoolState {
  chain
  poolId
  sqrtPriceX96
  tick
  liquidity
  protocolFee
  lpFee
  currentPrice
  currentPoolTick
}
    `;
export const TokenFieldsFragmentDoc = gql`
    fragment TokenFields on Token {
  id
  chain
  address
  symbol
  name
  decimals
  priceUSD
  priceChange24h
}
    `;
export const PoolFieldsFragmentDoc = gql`
    fragment PoolFields on Pool {
  id
  chain
  poolId
  protocolVersion
  token0 {
    ...TokenFields
  }
  token1 {
    ...TokenFields
  }
  feeTier
  tickSpacing
  hook {
    id
    address
  }
  sqrtPriceX96
  tick
  liquidity
  currentPrice
  protocolFee
  lpFee
  tvlUSD
  volume24hUSD
  fees24hUSD
  dynamicFeeBps
  apr
}
    ${TokenFieldsFragmentDoc}`;
export const PositionTokenFieldsFragmentDoc = gql`
    fragment PositionTokenFields on PositionToken {
  address
  symbol
  amount
  rawAmount
}
    `;
export const PositionFieldsFragmentDoc = gql`
    fragment PositionFields on Position {
  id
  chain
  positionId
  owner
  poolId
  token0 {
    ...PositionTokenFields
  }
  token1 {
    ...PositionTokenFields
  }
  tickLower
  tickUpper
  liquidity
  ageSeconds
  blockTimestamp
  lastTimestamp
  isInRange
  token0UncollectedFees
  token1UncollectedFees
  valueUSD
  feesUSD
}
    ${PositionTokenFieldsFragmentDoc}`;
export const TimestampedPoolPriceFieldsFragmentDoc = gql`
    fragment TimestampedPoolPriceFields on TimestampedPoolPrice {
  id
  timestamp
  token0Price
  token1Price
}
    `;
export const GetPoolStateDocument = gql`
    query GetPoolState($chain: Chain!, $poolId: String!) {
  poolState(chain: $chain, poolId: $poolId) {
    chain
    poolId
    sqrtPriceX96
    tick
    liquidity
    protocolFee
    lpFee
    currentPrice
    currentPoolTick
  }
}
    `;

/**
 * __useGetPoolStateQuery__
 *
 * To run a query within a React component, call `useGetPoolStateQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetPoolStateQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetPoolStateQuery({
 *   variables: {
 *      chain: // value for 'chain'
 *      poolId: // value for 'poolId'
 *   },
 * });
 */
export function useGetPoolStateQuery(baseOptions: Apollo.QueryHookOptions<Types.GetPoolStateQuery, Types.GetPoolStateQueryVariables> & ({ variables: Types.GetPoolStateQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<Types.GetPoolStateQuery, Types.GetPoolStateQueryVariables>(GetPoolStateDocument, options);
      }
export function useGetPoolStateLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<Types.GetPoolStateQuery, Types.GetPoolStateQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<Types.GetPoolStateQuery, Types.GetPoolStateQueryVariables>(GetPoolStateDocument, options);
        }
// @ts-ignore
export function useGetPoolStateSuspenseQuery(baseOptions?: Apollo.SuspenseQueryHookOptions<Types.GetPoolStateQuery, Types.GetPoolStateQueryVariables>): Apollo.UseSuspenseQueryResult<Types.GetPoolStateQuery, Types.GetPoolStateQueryVariables>;
export function useGetPoolStateSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<Types.GetPoolStateQuery, Types.GetPoolStateQueryVariables>): Apollo.UseSuspenseQueryResult<Types.GetPoolStateQuery | undefined, Types.GetPoolStateQueryVariables>;
export function useGetPoolStateSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<Types.GetPoolStateQuery, Types.GetPoolStateQueryVariables>) {
          const options = baseOptions === Apollo.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return Apollo.useSuspenseQuery<Types.GetPoolStateQuery, Types.GetPoolStateQueryVariables>(GetPoolStateDocument, options);
        }
export type GetPoolStateQueryHookResult = ReturnType<typeof useGetPoolStateQuery>;
export type GetPoolStateLazyQueryHookResult = ReturnType<typeof useGetPoolStateLazyQuery>;
export type GetPoolStateSuspenseQueryHookResult = ReturnType<typeof useGetPoolStateSuspenseQuery>;
export type GetPoolStateQueryResult = Apollo.QueryResult<Types.GetPoolStateQuery, Types.GetPoolStateQueryVariables>;
export const GetPoolDocument = gql`
    query GetPool($chain: Chain!, $poolId: String!) {
  pool(chain: $chain, poolId: $poolId) {
    id
    chain
    poolId
    protocolVersion
    sqrtPriceX96
    tick
    liquidity
    currentPrice
    tvlUSD
    volume24hUSD
    apr
  }
}
    `;

/**
 * __useGetPoolQuery__
 *
 * To run a query within a React component, call `useGetPoolQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetPoolQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetPoolQuery({
 *   variables: {
 *      chain: // value for 'chain'
 *      poolId: // value for 'poolId'
 *   },
 * });
 */
export function useGetPoolQuery(baseOptions: Apollo.QueryHookOptions<Types.GetPoolQuery, Types.GetPoolQueryVariables> & ({ variables: Types.GetPoolQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<Types.GetPoolQuery, Types.GetPoolQueryVariables>(GetPoolDocument, options);
      }
export function useGetPoolLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<Types.GetPoolQuery, Types.GetPoolQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<Types.GetPoolQuery, Types.GetPoolQueryVariables>(GetPoolDocument, options);
        }
// @ts-ignore
export function useGetPoolSuspenseQuery(baseOptions?: Apollo.SuspenseQueryHookOptions<Types.GetPoolQuery, Types.GetPoolQueryVariables>): Apollo.UseSuspenseQueryResult<Types.GetPoolQuery, Types.GetPoolQueryVariables>;
export function useGetPoolSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<Types.GetPoolQuery, Types.GetPoolQueryVariables>): Apollo.UseSuspenseQueryResult<Types.GetPoolQuery | undefined, Types.GetPoolQueryVariables>;
export function useGetPoolSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<Types.GetPoolQuery, Types.GetPoolQueryVariables>) {
          const options = baseOptions === Apollo.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return Apollo.useSuspenseQuery<Types.GetPoolQuery, Types.GetPoolQueryVariables>(GetPoolDocument, options);
        }
export type GetPoolQueryHookResult = ReturnType<typeof useGetPoolQuery>;
export type GetPoolLazyQueryHookResult = ReturnType<typeof useGetPoolLazyQuery>;
export type GetPoolSuspenseQueryHookResult = ReturnType<typeof useGetPoolSuspenseQuery>;
export type GetPoolQueryResult = Apollo.QueryResult<Types.GetPoolQuery, Types.GetPoolQueryVariables>;
export const GetPoolMetricsDocument = gql`
    query GetPoolMetrics($chain: Chain!, $poolId: String!) {
  poolMetrics(chain: $chain, poolId: $poolId) {
    poolId
    tvlUSD
    volume24hUSD
    fees24hUSD
    dynamicFeeBps
    apr
  }
}
    `;

/**
 * __useGetPoolMetricsQuery__
 *
 * To run a query within a React component, call `useGetPoolMetricsQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetPoolMetricsQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetPoolMetricsQuery({
 *   variables: {
 *      chain: // value for 'chain'
 *      poolId: // value for 'poolId'
 *   },
 * });
 */
export function useGetPoolMetricsQuery(baseOptions: Apollo.QueryHookOptions<Types.GetPoolMetricsQuery, Types.GetPoolMetricsQueryVariables> & ({ variables: Types.GetPoolMetricsQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<Types.GetPoolMetricsQuery, Types.GetPoolMetricsQueryVariables>(GetPoolMetricsDocument, options);
      }
export function useGetPoolMetricsLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<Types.GetPoolMetricsQuery, Types.GetPoolMetricsQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<Types.GetPoolMetricsQuery, Types.GetPoolMetricsQueryVariables>(GetPoolMetricsDocument, options);
        }
// @ts-ignore
export function useGetPoolMetricsSuspenseQuery(baseOptions?: Apollo.SuspenseQueryHookOptions<Types.GetPoolMetricsQuery, Types.GetPoolMetricsQueryVariables>): Apollo.UseSuspenseQueryResult<Types.GetPoolMetricsQuery, Types.GetPoolMetricsQueryVariables>;
export function useGetPoolMetricsSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<Types.GetPoolMetricsQuery, Types.GetPoolMetricsQueryVariables>): Apollo.UseSuspenseQueryResult<Types.GetPoolMetricsQuery | undefined, Types.GetPoolMetricsQueryVariables>;
export function useGetPoolMetricsSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<Types.GetPoolMetricsQuery, Types.GetPoolMetricsQueryVariables>) {
          const options = baseOptions === Apollo.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return Apollo.useSuspenseQuery<Types.GetPoolMetricsQuery, Types.GetPoolMetricsQueryVariables>(GetPoolMetricsDocument, options);
        }
export type GetPoolMetricsQueryHookResult = ReturnType<typeof useGetPoolMetricsQuery>;
export type GetPoolMetricsLazyQueryHookResult = ReturnType<typeof useGetPoolMetricsLazyQuery>;
export type GetPoolMetricsSuspenseQueryHookResult = ReturnType<typeof useGetPoolMetricsSuspenseQuery>;
export type GetPoolMetricsQueryResult = Apollo.QueryResult<Types.GetPoolMetricsQuery, Types.GetPoolMetricsQueryVariables>;
export const GetPoolPriceHistoryDocument = gql`
    query GetPoolPriceHistory($chain: Chain!, $poolId: String!, $duration: HistoryDuration!) {
  poolPriceHistory(chain: $chain, poolId: $poolId, duration: $duration) {
    id
    timestamp
    token0Price
    token1Price
  }
}
    `;

/**
 * __useGetPoolPriceHistoryQuery__
 *
 * To run a query within a React component, call `useGetPoolPriceHistoryQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetPoolPriceHistoryQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetPoolPriceHistoryQuery({
 *   variables: {
 *      chain: // value for 'chain'
 *      poolId: // value for 'poolId'
 *      duration: // value for 'duration'
 *   },
 * });
 */
export function useGetPoolPriceHistoryQuery(baseOptions: Apollo.QueryHookOptions<Types.GetPoolPriceHistoryQuery, Types.GetPoolPriceHistoryQueryVariables> & ({ variables: Types.GetPoolPriceHistoryQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<Types.GetPoolPriceHistoryQuery, Types.GetPoolPriceHistoryQueryVariables>(GetPoolPriceHistoryDocument, options);
      }
export function useGetPoolPriceHistoryLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<Types.GetPoolPriceHistoryQuery, Types.GetPoolPriceHistoryQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<Types.GetPoolPriceHistoryQuery, Types.GetPoolPriceHistoryQueryVariables>(GetPoolPriceHistoryDocument, options);
        }
// @ts-ignore
export function useGetPoolPriceHistorySuspenseQuery(baseOptions?: Apollo.SuspenseQueryHookOptions<Types.GetPoolPriceHistoryQuery, Types.GetPoolPriceHistoryQueryVariables>): Apollo.UseSuspenseQueryResult<Types.GetPoolPriceHistoryQuery, Types.GetPoolPriceHistoryQueryVariables>;
export function useGetPoolPriceHistorySuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<Types.GetPoolPriceHistoryQuery, Types.GetPoolPriceHistoryQueryVariables>): Apollo.UseSuspenseQueryResult<Types.GetPoolPriceHistoryQuery | undefined, Types.GetPoolPriceHistoryQueryVariables>;
export function useGetPoolPriceHistorySuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<Types.GetPoolPriceHistoryQuery, Types.GetPoolPriceHistoryQueryVariables>) {
          const options = baseOptions === Apollo.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return Apollo.useSuspenseQuery<Types.GetPoolPriceHistoryQuery, Types.GetPoolPriceHistoryQueryVariables>(GetPoolPriceHistoryDocument, options);
        }
export type GetPoolPriceHistoryQueryHookResult = ReturnType<typeof useGetPoolPriceHistoryQuery>;
export type GetPoolPriceHistoryLazyQueryHookResult = ReturnType<typeof useGetPoolPriceHistoryLazyQuery>;
export type GetPoolPriceHistorySuspenseQueryHookResult = ReturnType<typeof useGetPoolPriceHistorySuspenseQuery>;
export type GetPoolPriceHistoryQueryResult = Apollo.QueryResult<Types.GetPoolPriceHistoryQuery, Types.GetPoolPriceHistoryQueryVariables>;
export const GetPoolTicksDocument = gql`
    query GetPoolTicks($chain: Chain!, $poolId: String!, $skip: Int, $first: Int) {
  poolTicks(chain: $chain, poolId: $poolId, skip: $skip, first: $first) {
    id
    tickIdx
    liquidityGross
    liquidityNet
    price0
    price1
  }
}
    `;

/**
 * __useGetPoolTicksQuery__
 *
 * To run a query within a React component, call `useGetPoolTicksQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetPoolTicksQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetPoolTicksQuery({
 *   variables: {
 *      chain: // value for 'chain'
 *      poolId: // value for 'poolId'
 *      skip: // value for 'skip'
 *      first: // value for 'first'
 *   },
 * });
 */
export function useGetPoolTicksQuery(baseOptions: Apollo.QueryHookOptions<Types.GetPoolTicksQuery, Types.GetPoolTicksQueryVariables> & ({ variables: Types.GetPoolTicksQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<Types.GetPoolTicksQuery, Types.GetPoolTicksQueryVariables>(GetPoolTicksDocument, options);
      }
export function useGetPoolTicksLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<Types.GetPoolTicksQuery, Types.GetPoolTicksQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<Types.GetPoolTicksQuery, Types.GetPoolTicksQueryVariables>(GetPoolTicksDocument, options);
        }
// @ts-ignore
export function useGetPoolTicksSuspenseQuery(baseOptions?: Apollo.SuspenseQueryHookOptions<Types.GetPoolTicksQuery, Types.GetPoolTicksQueryVariables>): Apollo.UseSuspenseQueryResult<Types.GetPoolTicksQuery, Types.GetPoolTicksQueryVariables>;
export function useGetPoolTicksSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<Types.GetPoolTicksQuery, Types.GetPoolTicksQueryVariables>): Apollo.UseSuspenseQueryResult<Types.GetPoolTicksQuery | undefined, Types.GetPoolTicksQueryVariables>;
export function useGetPoolTicksSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<Types.GetPoolTicksQuery, Types.GetPoolTicksQueryVariables>) {
          const options = baseOptions === Apollo.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return Apollo.useSuspenseQuery<Types.GetPoolTicksQuery, Types.GetPoolTicksQueryVariables>(GetPoolTicksDocument, options);
        }
export type GetPoolTicksQueryHookResult = ReturnType<typeof useGetPoolTicksQuery>;
export type GetPoolTicksLazyQueryHookResult = ReturnType<typeof useGetPoolTicksLazyQuery>;
export type GetPoolTicksSuspenseQueryHookResult = ReturnType<typeof useGetPoolTicksSuspenseQuery>;
export type GetPoolTicksQueryResult = Apollo.QueryResult<Types.GetPoolTicksQuery, Types.GetPoolTicksQueryVariables>;
export const GetUserPositionsDocument = gql`
    query GetUserPositions($chain: Chain!, $owner: String!) {
  userPositions(chain: $chain, owner: $owner) {
    id
    chain
    positionId
    owner
    poolId
    token0 {
      address
      symbol
      amount
      rawAmount
    }
    token1 {
      address
      symbol
      amount
      rawAmount
    }
    tickLower
    tickUpper
    liquidity
    ageSeconds
    blockTimestamp
    lastTimestamp
    isInRange
    token0UncollectedFees
    token1UncollectedFees
  }
}
    `;

/**
 * __useGetUserPositionsQuery__
 *
 * To run a query within a React component, call `useGetUserPositionsQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetUserPositionsQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetUserPositionsQuery({
 *   variables: {
 *      chain: // value for 'chain'
 *      owner: // value for 'owner'
 *   },
 * });
 */
export function useGetUserPositionsQuery(baseOptions: Apollo.QueryHookOptions<Types.GetUserPositionsQuery, Types.GetUserPositionsQueryVariables> & ({ variables: Types.GetUserPositionsQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<Types.GetUserPositionsQuery, Types.GetUserPositionsQueryVariables>(GetUserPositionsDocument, options);
      }
export function useGetUserPositionsLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<Types.GetUserPositionsQuery, Types.GetUserPositionsQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<Types.GetUserPositionsQuery, Types.GetUserPositionsQueryVariables>(GetUserPositionsDocument, options);
        }
// @ts-ignore
export function useGetUserPositionsSuspenseQuery(baseOptions?: Apollo.SuspenseQueryHookOptions<Types.GetUserPositionsQuery, Types.GetUserPositionsQueryVariables>): Apollo.UseSuspenseQueryResult<Types.GetUserPositionsQuery, Types.GetUserPositionsQueryVariables>;
export function useGetUserPositionsSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<Types.GetUserPositionsQuery, Types.GetUserPositionsQueryVariables>): Apollo.UseSuspenseQueryResult<Types.GetUserPositionsQuery | undefined, Types.GetUserPositionsQueryVariables>;
export function useGetUserPositionsSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<Types.GetUserPositionsQuery, Types.GetUserPositionsQueryVariables>) {
          const options = baseOptions === Apollo.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return Apollo.useSuspenseQuery<Types.GetUserPositionsQuery, Types.GetUserPositionsQueryVariables>(GetUserPositionsDocument, options);
        }
export type GetUserPositionsQueryHookResult = ReturnType<typeof useGetUserPositionsQuery>;
export type GetUserPositionsLazyQueryHookResult = ReturnType<typeof useGetUserPositionsLazyQuery>;
export type GetUserPositionsSuspenseQueryHookResult = ReturnType<typeof useGetUserPositionsSuspenseQuery>;
export type GetUserPositionsQueryResult = Apollo.QueryResult<Types.GetUserPositionsQuery, Types.GetUserPositionsQueryVariables>;
export const GetPositionDocument = gql`
    query GetPosition($chain: Chain!, $positionId: String!) {
  position(chain: $chain, positionId: $positionId) {
    id
    chain
    positionId
    owner
    poolId
    token0 {
      address
      symbol
      amount
      rawAmount
    }
    token1 {
      address
      symbol
      amount
      rawAmount
    }
    tickLower
    tickUpper
    liquidity
    ageSeconds
    blockTimestamp
    lastTimestamp
    isInRange
    token0UncollectedFees
    token1UncollectedFees
    valueUSD
    feesUSD
  }
}
    `;

/**
 * __useGetPositionQuery__
 *
 * To run a query within a React component, call `useGetPositionQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetPositionQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetPositionQuery({
 *   variables: {
 *      chain: // value for 'chain'
 *      positionId: // value for 'positionId'
 *   },
 * });
 */
export function useGetPositionQuery(baseOptions: Apollo.QueryHookOptions<Types.GetPositionQuery, Types.GetPositionQueryVariables> & ({ variables: Types.GetPositionQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<Types.GetPositionQuery, Types.GetPositionQueryVariables>(GetPositionDocument, options);
      }
export function useGetPositionLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<Types.GetPositionQuery, Types.GetPositionQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<Types.GetPositionQuery, Types.GetPositionQueryVariables>(GetPositionDocument, options);
        }
// @ts-ignore
export function useGetPositionSuspenseQuery(baseOptions?: Apollo.SuspenseQueryHookOptions<Types.GetPositionQuery, Types.GetPositionQueryVariables>): Apollo.UseSuspenseQueryResult<Types.GetPositionQuery, Types.GetPositionQueryVariables>;
export function useGetPositionSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<Types.GetPositionQuery, Types.GetPositionQueryVariables>): Apollo.UseSuspenseQueryResult<Types.GetPositionQuery | undefined, Types.GetPositionQueryVariables>;
export function useGetPositionSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<Types.GetPositionQuery, Types.GetPositionQueryVariables>) {
          const options = baseOptions === Apollo.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return Apollo.useSuspenseQuery<Types.GetPositionQuery, Types.GetPositionQueryVariables>(GetPositionDocument, options);
        }
export type GetPositionQueryHookResult = ReturnType<typeof useGetPositionQuery>;
export type GetPositionLazyQueryHookResult = ReturnType<typeof useGetPositionLazyQuery>;
export type GetPositionSuspenseQueryHookResult = ReturnType<typeof useGetPositionSuspenseQuery>;
export type GetPositionQueryResult = Apollo.QueryResult<Types.GetPositionQuery, Types.GetPositionQueryVariables>;
export const GetPositionFeesDocument = gql`
    query GetPositionFees($chain: Chain!, $positionId: String!) {
  positionFees(chain: $chain, positionId: $positionId) {
    positionId
    token0Fees
    token1Fees
    token0FeesUSD
    token1FeesUSD
  }
}
    `;

/**
 * __useGetPositionFeesQuery__
 *
 * To run a query within a React component, call `useGetPositionFeesQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetPositionFeesQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetPositionFeesQuery({
 *   variables: {
 *      chain: // value for 'chain'
 *      positionId: // value for 'positionId'
 *   },
 * });
 */
export function useGetPositionFeesQuery(baseOptions: Apollo.QueryHookOptions<Types.GetPositionFeesQuery, Types.GetPositionFeesQueryVariables> & ({ variables: Types.GetPositionFeesQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<Types.GetPositionFeesQuery, Types.GetPositionFeesQueryVariables>(GetPositionFeesDocument, options);
      }
export function useGetPositionFeesLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<Types.GetPositionFeesQuery, Types.GetPositionFeesQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<Types.GetPositionFeesQuery, Types.GetPositionFeesQueryVariables>(GetPositionFeesDocument, options);
        }
// @ts-ignore
export function useGetPositionFeesSuspenseQuery(baseOptions?: Apollo.SuspenseQueryHookOptions<Types.GetPositionFeesQuery, Types.GetPositionFeesQueryVariables>): Apollo.UseSuspenseQueryResult<Types.GetPositionFeesQuery, Types.GetPositionFeesQueryVariables>;
export function useGetPositionFeesSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<Types.GetPositionFeesQuery, Types.GetPositionFeesQueryVariables>): Apollo.UseSuspenseQueryResult<Types.GetPositionFeesQuery | undefined, Types.GetPositionFeesQueryVariables>;
export function useGetPositionFeesSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<Types.GetPositionFeesQuery, Types.GetPositionFeesQueryVariables>) {
          const options = baseOptions === Apollo.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return Apollo.useSuspenseQuery<Types.GetPositionFeesQuery, Types.GetPositionFeesQueryVariables>(GetPositionFeesDocument, options);
        }
export type GetPositionFeesQueryHookResult = ReturnType<typeof useGetPositionFeesQuery>;
export type GetPositionFeesLazyQueryHookResult = ReturnType<typeof useGetPositionFeesLazyQuery>;
export type GetPositionFeesSuspenseQueryHookResult = ReturnType<typeof useGetPositionFeesSuspenseQuery>;
export type GetPositionFeesQueryResult = Apollo.QueryResult<Types.GetPositionFeesQuery, Types.GetPositionFeesQueryVariables>;
export const GetTokenPricesDocument = gql`
    query GetTokenPrices($chain: Chain!) {
  tokenPrices(chain: $chain) {
    BTC
    aBTC
    ETH
    aETH
    USDC
    aUSDC
    USDT
    aUSDT
    timestamp
  }
}
    `;

/**
 * __useGetTokenPricesQuery__
 *
 * To run a query within a React component, call `useGetTokenPricesQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetTokenPricesQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetTokenPricesQuery({
 *   variables: {
 *      chain: // value for 'chain'
 *   },
 * });
 */
export function useGetTokenPricesQuery(baseOptions: Apollo.QueryHookOptions<Types.GetTokenPricesQuery, Types.GetTokenPricesQueryVariables> & ({ variables: Types.GetTokenPricesQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<Types.GetTokenPricesQuery, Types.GetTokenPricesQueryVariables>(GetTokenPricesDocument, options);
      }
export function useGetTokenPricesLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<Types.GetTokenPricesQuery, Types.GetTokenPricesQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<Types.GetTokenPricesQuery, Types.GetTokenPricesQueryVariables>(GetTokenPricesDocument, options);
        }
// @ts-ignore
export function useGetTokenPricesSuspenseQuery(baseOptions?: Apollo.SuspenseQueryHookOptions<Types.GetTokenPricesQuery, Types.GetTokenPricesQueryVariables>): Apollo.UseSuspenseQueryResult<Types.GetTokenPricesQuery, Types.GetTokenPricesQueryVariables>;
export function useGetTokenPricesSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<Types.GetTokenPricesQuery, Types.GetTokenPricesQueryVariables>): Apollo.UseSuspenseQueryResult<Types.GetTokenPricesQuery | undefined, Types.GetTokenPricesQueryVariables>;
export function useGetTokenPricesSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<Types.GetTokenPricesQuery, Types.GetTokenPricesQueryVariables>) {
          const options = baseOptions === Apollo.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return Apollo.useSuspenseQuery<Types.GetTokenPricesQuery, Types.GetTokenPricesQueryVariables>(GetTokenPricesDocument, options);
        }
export type GetTokenPricesQueryHookResult = ReturnType<typeof useGetTokenPricesQuery>;
export type GetTokenPricesLazyQueryHookResult = ReturnType<typeof useGetTokenPricesLazyQuery>;
export type GetTokenPricesSuspenseQueryHookResult = ReturnType<typeof useGetTokenPricesSuspenseQuery>;
export type GetTokenPricesQueryResult = Apollo.QueryResult<Types.GetTokenPricesQuery, Types.GetTokenPricesQueryVariables>;
export const GetTokenDocument = gql`
    query GetToken($chain: Chain!, $address: String) {
  token(chain: $chain, address: $address) {
    id
    chain
    address
    symbol
    name
    decimals
    priceUSD
    priceChange24h
  }
}
    `;

/**
 * __useGetTokenQuery__
 *
 * To run a query within a React component, call `useGetTokenQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetTokenQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetTokenQuery({
 *   variables: {
 *      chain: // value for 'chain'
 *      address: // value for 'address'
 *   },
 * });
 */
export function useGetTokenQuery(baseOptions: Apollo.QueryHookOptions<Types.GetTokenQuery, Types.GetTokenQueryVariables> & ({ variables: Types.GetTokenQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<Types.GetTokenQuery, Types.GetTokenQueryVariables>(GetTokenDocument, options);
      }
export function useGetTokenLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<Types.GetTokenQuery, Types.GetTokenQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<Types.GetTokenQuery, Types.GetTokenQueryVariables>(GetTokenDocument, options);
        }
// @ts-ignore
export function useGetTokenSuspenseQuery(baseOptions?: Apollo.SuspenseQueryHookOptions<Types.GetTokenQuery, Types.GetTokenQueryVariables>): Apollo.UseSuspenseQueryResult<Types.GetTokenQuery, Types.GetTokenQueryVariables>;
export function useGetTokenSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<Types.GetTokenQuery, Types.GetTokenQueryVariables>): Apollo.UseSuspenseQueryResult<Types.GetTokenQuery | undefined, Types.GetTokenQueryVariables>;
export function useGetTokenSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<Types.GetTokenQuery, Types.GetTokenQueryVariables>) {
          const options = baseOptions === Apollo.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return Apollo.useSuspenseQuery<Types.GetTokenQuery, Types.GetTokenQueryVariables>(GetTokenDocument, options);
        }
export type GetTokenQueryHookResult = ReturnType<typeof useGetTokenQuery>;
export type GetTokenLazyQueryHookResult = ReturnType<typeof useGetTokenLazyQuery>;
export type GetTokenSuspenseQueryHookResult = ReturnType<typeof useGetTokenSuspenseQuery>;
export type GetTokenQueryResult = Apollo.QueryResult<Types.GetTokenQuery, Types.GetTokenQueryVariables>;