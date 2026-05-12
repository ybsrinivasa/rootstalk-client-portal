/**
 * FastAPI returns `detail` as either a string OR a structured
 * object like `{code, message, errors, ...}` depending on the
 * exception. When the object lands in a useState string and the
 * JSX renders it as a React child, React throws
 *   "Objects are not valid as a React child"
 * which crashes the tree and Chrome shows "This page couldn't
 * load."
 *
 * Always run axios errors through `extractErrorMessage` before
 * assigning to error state used in JSX. Returns a guaranteed
 * string.
 *
 * Originally derived from the SA-portal Add Practice fix
 * (2026-05-11 `2307c87`); promoted to a shared helper during
 * the sweep across the CA portal.
 */
type AxiosLike = {
  response?: {
    data?: {
      detail?: unknown
    }
  }
}

export function extractErrorMessage(err: unknown, fallback: string): string {
  const detail = (err as AxiosLike)?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (detail && typeof detail === 'object') {
    const obj = detail as { code?: string; message?: string }
    if (obj.message) return obj.message
  }
  return fallback
}
