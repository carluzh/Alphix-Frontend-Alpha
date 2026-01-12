/**
 * Test Fixture Factory
 *
 * COPIED FROM UNISWAP - Creates type-safe fixture factories with options
 * Source: interface/packages/uniswap/src/test/utils/factory.ts
 *
 * Adapted: Removed es-toolkit dependency, using inline pick/omit
 */

// Inline pick/omit to avoid external dependency
function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key]
    }
  }
  return result
}

function omit<T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const result = { ...obj }
  for (const key of keys) {
    delete (result as Record<string, unknown>)[key as string]
  }
  return result as Omit<T, K>
}

/**
 * Creates a fixture factory function for generating test data.
 *
 * Supports three modes:
 * 1. Without custom options - simple data generation
 * 2. With static custom options - influences data generation
 * 3. With dynamic custom options via getter function
 */
// If there are no custom options
export function createFixture<T extends object>(): {
  <V extends T>(
    getValues: () => V,
  ): {
    <O extends Partial<T>>(overrides: O): Omit<V, keyof O> & O
    (): V
  }
}

// If there are custom options with default values object
export function createFixture<T extends object, P extends object>(
  defaultOptions: Required<P>,
): {
  <V extends T>(
    getValues: (options: P) => V,
  ): {
    <O extends Partial<T & P>>(overrides: O): Omit<V, Exclude<keyof O, keyof T>> & Omit<O, keyof P>
    (): V
  }
}

// If there are custom options with default values getter function
export function createFixture<T extends object, P extends object>(
  getDefaultOptions: () => Required<P>,
): {
  <V extends T>(
    getValues: (options: P) => V,
  ): {
    <O extends Partial<T & P>>(overrides: O): Omit<V, Exclude<keyof O, keyof T>> & Omit<O, keyof P>
    (): V
  }
}

export function createFixture<T extends object, P extends object>(
  defaultOptionsOrGetter?: Required<P> | (() => Required<P>),
) {
  return <V extends T>(getValues: (options?: P) => V) => {
    return <O extends Partial<T> | Partial<T & P>>(overrides?: O) => {
      // Get default options (if they exist)
      const defaultOptions =
        typeof defaultOptionsOrGetter === 'function' ? defaultOptionsOrGetter() : defaultOptionsOrGetter

      // Get overrides for options (filter out undefined values)
      const optionKeys = defaultOptions ? Object.keys(defaultOptions) : []
      const optionOverrides = Object.fromEntries(
        Object.entries(
          defaultOptions ? pick(overrides || ({} as Record<string, unknown>), optionKeys as (keyof (typeof overrides))[]) : {},
        ).filter(([, value]) => value !== undefined),
      )

      // Get values with getValues function
      const mergedOptions = defaultOptions ? { ...defaultOptions, ...optionOverrides } : undefined
      const values = getValues(mergedOptions as P | undefined)

      // Get overrides for values
      const valueOverrides = overrides ? omit(overrides as Record<string, unknown>, optionKeys as (keyof (typeof overrides))[]) : {}

      return Array.isArray(values)
        ? values.map((v) => ({ ...v, ...valueOverrides }))
        : { ...values, ...valueOverrides }
    }
  }
}
