type RateLimitEntry = {
  count: number
  resetAt: number
}

type RateLimitOptions = {
  limit: number
  windowMs: number
}

type RateLimitResult = {
  allowed: boolean
  retryAfterMs: number
}

const MAX_ENTRIES = 10_000

const entries = new Map<string, RateLimitEntry>()

function prune(now: number) {
  for (const [key, entry] of entries) {
    if (entry.resetAt <= now) {
      entries.delete(key)
    }
  }

  // Keep the map bounded even when every entry is still active.
  for (const key of entries.keys()) {
    if (entries.size < MAX_ENTRIES) break
    entries.delete(key)
  }
}

/**
 * Fixed-window in-memory rate limiter.
 *
 * Intended to protect low-volume endpoints on a single instance. Deployments
 * with multiple instances need a shared store instead.
 */
export function consumeRateLimit(
  key: string,
  { limit, windowMs }: RateLimitOptions
): RateLimitResult {
  const now = Date.now()

  if (entries.size >= MAX_ENTRIES) {
    prune(now)
  }

  const entry = entries.get(key)

  if (!entry || entry.resetAt <= now) {
    entries.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, retryAfterMs: 0 }
  }

  if (entry.count >= limit) {
    return { allowed: false, retryAfterMs: entry.resetAt - now }
  }

  entry.count += 1
  return { allowed: true, retryAfterMs: 0 }
}
