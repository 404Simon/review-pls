import { db } from "@/db"
import { contentDisposition, idSchema, jsonError } from "@/lib/review/api"
import {
  buildExportDocument,
  type ExportDocumentType,
} from "@/lib/review/export-data"
import { ReviewDataError } from "@/lib/review/load"
import { AuthorizationError, requireAdmin } from "@/lib/review/roles"
import { getSession } from "@/lib/session"

interface RouteParams {
  batch: string
}

type RouteContext = { params: Promise<RouteParams> }

function isDownloadType(value: string): value is ExportDocumentType {
  return value === "dataset" || value === "decisions"
}

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
  if (!isDownloadType(requestedType)) {
    return jsonError(
      400,
      "invalid_request",
      "type must be dataset or decisions."
    )
  }

  const now = Date.now()
  let document: Awaited<ReturnType<typeof buildExportDocument>>
  try {
    document = await buildExportDocument(db, batchId.data, requestedType, {
      now,
    })
  } catch (error) {
    if (error instanceof ReviewDataError) {
      return jsonError(404, "not_found", "This batch is not available.")
    }
    throw error
  }

  return new Response(document.content, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": contentDisposition(
        document.fileName,
        "attachment"
      ),
      "Content-Length": String(Buffer.byteLength(document.content, "utf8")),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
