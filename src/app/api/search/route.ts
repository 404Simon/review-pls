import {
  jsonError,
  searchOutcomeResponse,
  searchQuerySchema,
} from "@/lib/review/api"
import { searchCode, searchPaper } from "@/lib/review/evidence"
import { loadPaper, ReviewDataError } from "@/lib/review/load"
import { consumeRateLimit } from "@/lib/rate-limit"
import { getSession } from "@/lib/session"

const SEARCH_RATE_LIMIT = { limit: 30, windowMs: 60_000 }

export async function GET(request: Request): Promise<Response> {
  const session = await getSession()
  if (!session) {
    return jsonError(401, "unauthorized", "Sign in to search evidence.")
  }

  const url = new URL(request.url)
  const query = searchQuerySchema.safeParse({
    batch: url.searchParams.get("batch") ?? "",
    paper: url.searchParams.get("paper") ?? "",
    scope: url.searchParams.get("scope") ?? "",
    q: url.searchParams.get("q") ?? "",
  })
  if (!query.success) {
    return jsonError(400, "invalid_request", "Invalid search query.")
  }

  const rate = consumeRateLimit(
    `evidence-search:${session.user.id}`,
    SEARCH_RATE_LIMIT
  )
  if (!rate.allowed) {
    return jsonError(
      429,
      "rate_limited",
      "Too many searches. Try again shortly.",
      {
        "Retry-After": String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))),
      }
    )
  }

  let paper
  try {
    paper = await loadPaper(query.data.batch, query.data.paper)
  } catch (error) {
    if (error instanceof ReviewDataError) {
      return jsonError(404, "not_found", "The paper is not available.")
    }
    throw error
  }

  const outcome =
    query.data.scope === "code"
      ? await searchCode(paper, query.data.batch, query.data.q)
      : await searchPaper(paper, query.data.batch, query.data.q)

  return searchOutcomeResponse(outcome)
}
