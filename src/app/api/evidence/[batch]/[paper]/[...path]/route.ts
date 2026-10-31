import { open, type FileHandle } from "node:fs/promises"

import {
  contentDisposition,
  contentTypeFor,
  evidenceDownloadSchema,
  evidenceErrnoResponse,
  idSchema,
  jsonError,
  parsePathSegments,
  parseRangeHeader,
} from "@/lib/review/api"
import {
  isIgnoredRelativePath,
  resolvePaperFilePath,
} from "@/lib/review/evidence"
import {
  loadBatch,
  loadPaper,
  ReviewDataError,
  type LoadedBatch,
  type LoadedPaper,
} from "@/lib/review/load"
import { getSession } from "@/lib/session"

interface RouteParams {
  batch: string
  paper: string
  path: string[]
}

type RouteContext = { params: Promise<RouteParams> }

/**
 * Stream an open file with pull-based backpressure. Each chunk is copied into
 * a plain Uint8Array so the response never holds the whole file in memory.
 */
function fileBody(
  handle: FileHandle,
  start: number,
  end: number
): ReadableStream<Uint8Array> {
  const stream = handle.createReadStream({ start, end, autoClose: true })
  const iterator = stream[Symbol.asyncIterator]()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next()
        if (done) {
          controller.close()
          return
        }
        controller.enqueue(new Uint8Array(value))
      } catch (error) {
        controller.error(error)
      }
    },
    async cancel() {
      await iterator.return?.(undefined)
      stream.destroy()
    },
  })
}

async function handle(
  request: Request,
  context: RouteContext,
  headOnly: boolean
): Promise<Response> {
  const session = await getSession()
  if (!session) {
    return jsonError(401, "unauthorized", "Sign in to read review evidence.")
  }

  const params = await context.params
  const batchId = idSchema.safeParse(params.batch)
  const paperId = idSchema.safeParse(params.paper)
  if (!batchId.success || !paperId.success) {
    return jsonError(400, "invalid_request", "Invalid batch or paper id.")
  }

  const url = new URL(request.url)
  const download = evidenceDownloadSchema.safeParse(
    url.searchParams.get("download") ?? undefined
  )
  if (!download.success) {
    return jsonError(400, "invalid_request", "Invalid download parameter.")
  }

  const relative = parsePathSegments(params.path)
  if (relative === null) {
    return jsonError(400, "invalid_path", "The evidence path is not allowed.")
  }
  if (isIgnoredRelativePath(relative)) {
    return jsonError(404, "not_found", "The evidence file is not available.")
  }

  let batch: LoadedBatch
  let paper: LoadedPaper
  try {
    batch = await loadBatch(batchId.data)
    paper = await loadPaper(batchId.data, paperId.data)
  } catch (error) {
    if (error instanceof ReviewDataError) {
      return jsonError(404, "not_found", "The paper is not available.")
    }
    throw error
  }

  const paperDir = paper.dir
  const file = await resolvePaperFilePath(paperDir, batch.dir, relative)
  if (!file) {
    return jsonError(404, "not_found", "The evidence file is not available.")
  }

  const { contentType, disposition } = contentTypeFor(file.relativePath)
  const headers = new Headers({
    "Content-Type": contentType,
    "Content-Disposition": contentDisposition(
      file.relativePath,
      download.data === "1" ? "attachment" : disposition
    ),
    "Cache-Control": "private, max-age=0, must-revalidate",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
  })

  const range = parseRangeHeader(request.headers.get("range"), file.size)
  if (range === "invalid") {
    headers.set("Content-Range", `bytes */${file.size}`)
    headers.set("Content-Length", "0")
    return new Response(null, { status: 416, headers })
  }

  // Open before sending headers so permission and disappearance errors are
  // controlled responses instead of a broken stream.
  let handle: FileHandle
  try {
    handle = await open(file.realPath, "r")
  } catch (error) {
    const response = evidenceErrnoResponse(error)
    if (response) {
      return response
    }
    throw error
  }

  if (range) {
    const length = range.end - range.start + 1
    headers.set(
      "Content-Range",
      `bytes ${range.start}-${range.end}/${file.size}`
    )
    headers.set("Content-Length", String(length))
    if (headOnly) {
      await handle.close()
      return new Response(null, { status: 206, headers })
    }
    return new Response(fileBody(handle, range.start, range.end), {
      status: 206,
      headers,
    })
  }

  headers.set("Content-Length", String(file.size))
  if (headOnly || file.size === 0) {
    await handle.close()
    return new Response(null, { status: 200, headers })
  }
  return new Response(fileBody(handle, 0, file.size - 1), {
    status: 200,
    headers,
  })
}

export async function GET(
  request: Request,
  context: RouteContext
): Promise<Response> {
  return handle(request, context, false)
}

export async function HEAD(
  request: Request,
  context: RouteContext
): Promise<Response> {
  return handle(request, context, true)
}
