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
