export class FetchError extends Error {
  response: Response
  data?: unknown
  constructor({ response, data, cause }: { response: Response; data?: unknown; cause?: unknown }) {
    super(`Response status: ${response.status}`)
    this.name = 'FetchError'
    this.response = response
    this.data = data
    this.cause = cause
  }
}

export function isRateLimitFetchError(error: unknown): boolean {
  return error instanceof FetchError && !!error.response.status && error.response.status >= 412 && error.response.status <= 429
}

export function is404Error(error: unknown): boolean {
  return error instanceof FetchError && !!error.response.status && error.response.status === 404
}
