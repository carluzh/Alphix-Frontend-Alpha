import { ApolloLink } from '@apollo/client'
import { onError } from '@apollo/client/link/error'

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
            console.error(`[Apollo] GraphQL ${operationName} error: ${message}`, {
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
        () => console.error('[Apollo] Network error:', networkError),
        networkErrorSamplingRate,
      )
    }
  })

  return errorLink
}
