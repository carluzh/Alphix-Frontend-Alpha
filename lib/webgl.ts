/**
 * WebGL2 capability detection.
 *
 * `@paper-design/shaders-react` (GrainGradient et al.) requires a WebGL2 context:
 * its ShaderMount constructor calls `canvas.getContext('webgl2')` and throws
 * `Error("Paper Shaders: WebGL is not supported in this browser")` when that
 * returns null. Critically, the throw happens inside an async `initShader()` run
 * from a `useEffect` with no `.catch()`, so it surfaces as an UNHANDLED PROMISE
 * REJECTION that a React error boundary cannot catch (and which Sentry's global
 * onunhandledrejection handler reports). The only safe handling is to NOT mount
 * the shader when WebGL2 is unavailable — gate every shader call site on this.
 *
 * Cached: context creation is cheap but not free, and support never changes
 * within a page session. SSR-safe (returns false on the server).
 */
let cached: boolean | null = null

export function isWebGL2Supported(): boolean {
  if (typeof window === 'undefined') return false
  if (cached !== null) return cached
  try {
    const canvas = document.createElement('canvas')
    cached = !!canvas.getContext('webgl2')
  } catch {
    cached = false
  }
  return cached
}
