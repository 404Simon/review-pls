/**
 * Small server-side clock boundary. Pages and actions call this instead of
 * reading `Date.now()` inside a component body, which keeps React's render
 * purity rule intact and makes the read easy to override in tests.
 */
export function currentTimeMs(): number {
  return Date.now()
}
