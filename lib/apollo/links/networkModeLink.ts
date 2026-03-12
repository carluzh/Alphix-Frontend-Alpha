import { ApolloLink } from '@apollo/client'
import { apolloChainForMode } from '@/lib/network-mode'
import type { NetworkMode } from '@/lib/network-mode'

export function getNetworkModeLink(): ApolloLink {
  return new ApolloLink((operation, forward) => {
    // Prefer networkMode from operation variables/context (set by the calling hook)
    // This allows each query to target a specific chain rather than relying on global state
    const vars = operation.variables as Record<string, any> | undefined
    const ctx = operation.getContext() as Record<string, any>
    const networkMode: NetworkMode = ctx.networkMode ?? vars?.networkMode ?? 'base'
    const chain = apolloChainForMode(networkMode)

    operation.setContext(({ headers = {} }: { headers?: Record<string, string> }) => ({
      headers: {
        ...headers,
        'x-network-mode': networkMode,
        'x-chain': chain,
      },
      networkMode,
      chain,
    }))

    return forward(operation)
  })
}

export const networkModeLink = getNetworkModeLink()
