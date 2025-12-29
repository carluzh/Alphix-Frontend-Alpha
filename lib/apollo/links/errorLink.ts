/**
 * Apollo Error Link
 *
 * Handles GraphQL and network errors with sampling.
 * Identical to Uniswap's implementation.
 *
 * @see interface/packages/uniswap/src/data/links.ts
 */

import { ApolloLink } from '@apollo/client'
import { onError } from '@apollo/client/link/error'
import { logger } from '@/lib/logger'

// Samples error reports to reduce load on backend
// Recurring errors that we must fix should have enough occurrences that we detect them still
const APOLLO_GRAPHQL_ERROR_SAMPLING_RATE = 0.1
const APOLLO_NETWORK_ERROR_SAMPLING_RATE = 0.01

export function sample(cb: () => void, rate: number): void {
  if (Math.random() < rate) {
    cb()
  }
}

export function getErrorLink(
  graphqlErrorSamplingRate = APOLLO_GRAPHQL_ERROR_SAMPLING_RATE,
  networkErrorSamplingRate = APOLLO_NETWORK_ERROR_SAMPLING_RATE,
): ApolloLink {
  // Log any GraphQL errors or network error that occurred
  const errorLink = onError(({ graphQLErrors, networkError, operation }) => {
    if (graphQLErrors) {
      const operationName = operation.operationName
      const operationVariables = JSON.stringify(operation.variables)
      graphQLErrors.forEach(({ message, locations, path }) => {
        sample(
          () =>
            logger.error(`GraphQL ${operationName} error: ${message}`, new Error(message), {
              message,
              locations,
              path,
              operationName,
              operationVariables,
            }),
          graphqlErrorSamplingRate,
        )
      })
    }
    if (networkError) {
      sample(
        () => logger.error('Apollo network error', networkError as Error),
        networkErrorSamplingRate,
      )
    }
  })

  return errorLink
}

// Default export for backward compatibility
export const errorLink = getErrorLink()
