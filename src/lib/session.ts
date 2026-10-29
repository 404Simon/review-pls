import { headers } from "next/headers"
import { cache } from "react"

import { auth } from "@/lib/auth"

/**
 * Resolve the current session on the server.
 *
 * Cached per request so layouts, pages, and guards can call it without
 * re-validating the session token every time.
 */
export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() })
})
