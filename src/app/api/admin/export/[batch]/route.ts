import { db } from "@/db"
import { contentDisposition, idSchema, jsonError } from "@/lib/review/api"
import {
  buildDecisionsExport,
  buildReviewDataset,
  exportFileName,
  exportTypeSchema,
} from "@/lib/review/export"
import { loadExportData } from "@/lib/review/export-data"
import { ReviewDataError } from "@/lib/review/load"
import { AuthorizationError, requireAdmin } from "@/lib/review/roles"
import { getSession } from "@/lib/session"

interface RouteParams {
  batch: string
}

type RouteContext = { params: Promise<RouteParams> }

const DOWNLOAD_TYPES = new Set(["dataset", "decisions"])

export async function GET(
  request: Request,
  context: RouteContext
): Promise<Response> {
  const session = await getSession()
  if (!session) {
    return jsonError(401, "unauthorized", "Sign in to export reviews.")
  }

  try {
    await requireAdmin(session.user, { db })
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return jsonError(403, "forbidden", "Only admins can export reviews.")
    }
    throw error
  }

  const { batch } = await context.params
  const batchId = idSchema.safeParse(batch)
  if (!batchId.success) {
    return jsonError(400, "invalid_request", "Invalid batch id.")
  }

  const url = new URL(request.url)
  const requestedType = url.searchParams.get("type") ?? "dataset"
  if (!DOWNLOAD_TYPES.has(requestedType)) {
    return jsonError(
      400,
      "invalid_request",
      "type must be dataset or decisions."
    )
  }
  const type = exportTypeSchema.parse(requestedType)
  if (type === "both") {
    return jsonError(400, "invalid_request", "Choose a single export type.")
  }

  const now = Date.now()
  let body: string
  try {
    const data = await loadExportData(db, batchId.data, {
      now,
      includeExpiredClaims: type === "dataset",
    })
    const exported =
      type === "dataset" ? buildReviewDataset(data) : buildDecisionsExport(data)
    body = `${JSON.stringify(exported, null, 2)}\n`
  } catch (error) {
    if (error instanceof ReviewDataError) {
      return jsonError(404, "not_found", "This batch is not available.")
    }
    throw error
  }

  const fileName = exportFileName(type, now)
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": contentDisposition(fileName, "attachment"),
      "Content-Length": String(Buffer.byteLength(body, "utf8")),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
