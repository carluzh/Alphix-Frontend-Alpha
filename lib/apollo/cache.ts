import { FieldFunctionOptions, InMemoryCache } from '@apollo/client'
import { Reference, relayStylePagination, StoreObject } from '@apollo/client/utilities'
import { getAddress, isAddress } from 'viem'

export function setupSharedApolloCache(): InMemoryCache {
  return new InMemoryCache({
    typePolicies: {
      Query: {
        fields: {
          // relayStylePagination function unfortunately generates a field policy that ignores args
          // Note: all non-pagination related query args should be added for cache to work properly.
          // ^ This ensures that cache doesnt get overwritten by similar queries with different args
          userPositions: {
            keyArgs: ['owner', 'chain'],
          },
          poolPriceHistory: {
            keyArgs: ['poolId', 'duration'],
          },

          /*
           * CACHE REDIRECTS
           *
           * When queries require params, Apollo cannot return partial data from cache
           * because it will not know the `id` until data is received.
           * The following redirects set ids to values known ahead of time.
           *
           * NOTE: may require setting a Field policy to ensure ids are stored in the
           *      format we specify. See `token()` below for a full example.
           */

          // simply use chain / address pair as id instead for tokens
          token: {
            read(_, { args, toReference }): Reference | undefined {
              return toReference({
                __typename: 'Token',
                chain: args?.chain,
                address: normalizeTokenAddressForCache(args?.address),
              })
            },
          },

          // use chain / poolId pair for pools
          pool: {
            read(_, { args, toReference }): Reference | undefined {
              return toReference({
                __typename: 'Pool',
                chain: args?.chain,
                poolId: args?.poolId,
              })
            },
          },

          // use chain / positionId pair for positions
          position: {
            read(_, { args, toReference }): Reference | undefined {
              return toReference({
                __typename: 'Position',
                chain: args?.chain,
                positionId: args?.positionId,
              })
            },
          },
        },
      },
      Token: {
        /**
         * Key by `[chain, address]` so that when querying by `Token(chain, address)` we can read from cache.
         *
         * NOTE: In every query that returns a `Token` object, you must always request the `chain` and `address` fields
         *       in order for the result to be normalized properly in the cache.
         */
        keyFields: ['chain', 'address'],
        fields: {
          address: {
            read(address: string | null): string | null {
              return normalizeTokenAddressForCache(address)
            },
          },
          priceUSD: {
            // Ensure priceUSD doesn't get overwritten with null values
            merge: ignoreIncomingNullValue,
          },
        },
      },
      Pool: {
        /**
         * Key by `[chain, poolId]` so that when querying by `Pool(chain, poolId)` we can read from cache.
         */
        keyFields: ['chain', 'poolId'],
        fields: {
          tvlUSD: {
            merge: ignoreIncomingNullValue,
          },
          volume24hUSD: {
            merge: ignoreIncomingNullValue,
          },
        },
      },
      PoolState: {
        /**
         * Key by `[chain, poolId]` for pool state
         */
        keyFields: ['chain', 'poolId'],
      },
      Position: {
        /**
         * Key by `[chain, positionId]` for positions
         */
        keyFields: ['chain', 'positionId'],
        fields: {
          token0: {
            merge: true,
          },
          token1: {
            merge: true,
          },
        },
      },
      PriceHistory: {
        keyFields: false,
      },
      FeeItem: {
        keyFields: ['positionId'],
      },
      // Disable normalization for these types since we want them stored by their parent.
      Amount: {
        keyFields: false,
        merge: true,
      },
      TimestampedAmount: { keyFields: false },
    },
  })
}

// eslint-disable-next-line max-params
function ignoreIncomingNullValue(
  existing: Reference | StoreObject,
  incoming: Reference | StoreObject,
  { mergeObjects }: FieldFunctionOptions<Record<string, unknown>, Record<string, unknown>>,
): Reference | StoreObject {
  return mergeObjects(existing, incoming)
}

function incomingOrExistingArray(
  existing: unknown[] | undefined,
  incoming: unknown[] | undefined,
): unknown[] | undefined {
  return incoming ?? existing
}

export function normalizeTokenAddressForCache(address: string): string
export function normalizeTokenAddressForCache(address: null): null
export function normalizeTokenAddressForCache(address: string | null): string | null
export function normalizeTokenAddressForCache(address: string | null): string | null {
  // Our backend would sometimes return checksummed addresses and sometimes lowercase addresses.
  // In order to improve local cache hits, avoid unnecessary network requests, and avoid having duplicate `Token` items stored in the cache,
  // we use lowercase addresses when accessing the `Token` object from our local cache.

  if (address === 'NATIVE' || address === 'native') {
    return 'native' // lowercased native address for lowercase consistency
  }

  // Validate and lowercase EVM addresses
  if (address && isAddress(address)) {
    return address.toLowerCase()
  }

  return address ?? null
}
