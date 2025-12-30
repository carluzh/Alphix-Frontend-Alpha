/**
 * Test Render Utilities
 *
 * Provides render functions with Apollo MockedProvider for testing.
 * Adapted from Uniswap's test-utils/render.tsx
 *
 * @see interface/apps/web/src/test-utils/render.tsx
 */

import React, { PropsWithChildren, ReactElement } from 'react'
import { MockedProvider, MockedResponse } from '@apollo/client/testing'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  render as rtlRender,
  renderHook as rtlRenderHook,
  RenderOptions,
  RenderHookOptions,
} from '@testing-library/react'
import { NetworkProvider } from '@/lib/network-context'

// Create a fresh QueryClient for each test
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

interface TestProvidersProps {
  children: React.ReactNode
  mocks?: MockedResponse[]
  queryClient?: QueryClient
}

/**
 * Test providers wrapper with Apollo MockedProvider
 */
function TestProviders({
  children,
  mocks = [],
  queryClient = createTestQueryClient(),
}: TestProvidersProps) {
  return (
    <MockedProvider mocks={mocks} addTypename={false}>
      <QueryClientProvider client={queryClient}>
        <NetworkProvider>
          {children}
        </NetworkProvider>
      </QueryClientProvider>
    </MockedProvider>
  )
}

type CustomRenderOptions = Omit<RenderOptions, 'wrapper'> & {
  mocks?: MockedResponse[]
  queryClient?: QueryClient
}

/**
 * Custom render with Apollo and Query providers
 */
function customRender(ui: ReactElement, options?: CustomRenderOptions) {
  const { mocks, queryClient, ...renderOptions } = options || {}

  const Wrapper = ({ children }: PropsWithChildren) => (
    <TestProviders mocks={mocks} queryClient={queryClient}>
      {children}
    </TestProviders>
  )

  return rtlRender(ui, { wrapper: Wrapper, ...renderOptions })
}

type CustomRenderHookOptions<Props> = Omit<RenderHookOptions<Props>, 'wrapper'> & {
  mocks?: MockedResponse[]
  queryClient?: QueryClient
}

/**
 * Custom renderHook with Apollo and Query providers
 */
function customRenderHook<Result, Props>(
  hook: (initialProps: Props) => Result,
  options?: CustomRenderHookOptions<Props>
) {
  const { mocks, queryClient, ...renderOptions } = options || {}

  const Wrapper = ({ children }: PropsWithChildren) => (
    <TestProviders mocks={mocks} queryClient={queryClient}>
      {children}
    </TestProviders>
  )

  return rtlRenderHook(hook, { wrapper: Wrapper, ...renderOptions })
}

// Re-export everything from @testing-library/react
export * from '@testing-library/react'

// Export custom render functions
export { customRender as render, customRenderHook as renderHook }
