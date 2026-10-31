import { jsonError, treeQuerySchema } from "@/lib/review/api"
import { listTree } from "@/lib/review/evidence"
import { loadPaper, ReviewDataError } from "@/lib/review/load"
import { getSession } from "@/lib/session"

export async function GET(request: Request): Promise<Response> {
  const session = await getSession()
  if (!session) {
    return jsonError(401, "unauthorized", "Sign in to browse evidence.")
  }

  const url = new URL(request.url)
  const query = treeQuerySchema.safeParse({
    batch: url.searchParams.get("batch") ?? "",
    paper: url.searchParams.get("paper") ?? "",
    scope: url.searchParams.get("scope") ?? "",
  })
  if (!query.success) {
    return jsonError(400, "invalid_request", "Invalid tree query.")
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

  const tree = await listTree({ paper, scope: query.data.scope })
  return Response.json(tree)
}
