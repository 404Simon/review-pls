import path from "node:path"

import { z } from "zod"

export const idSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "invalid id")

export const treeScopeSchema = z.enum(["code", "paper", "run", "auditowl"])
export type TreeScope = z.infer<typeof treeScopeSchema>

export const searchScopeSchema = z.enum(["code", "paper"])
export type SearchScope = z.infer<typeof searchScopeSchema>

export const treeQuerySchema = z.object({
  batch: idSchema,
  paper: idSchema,
  scope: treeScopeSchema,
})

export const searchQuerySchema = z.object({
  batch: idSchema,
  paper: idSchema,
  scope: searchScopeSchema,
  q: z
    .string()
    .trim()
    .min(1, "a search query is required")
    .max(200, "the search query is too long")
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
      message: "the search query contains control characters",
    }),
})

export const evidenceDownloadSchema = z.enum(["0", "1"]).optional()

export interface ApiErrorBody {
  error: string
  message?: string
}

export interface SearchApiOutcome<T> {
  results: T[]
  truncated: boolean
  unavailable: boolean
}

/** Map a search outcome to the public route response (including 503). */
export function searchOutcomeResponse<T>(
  outcome: SearchApiOutcome<T>
): Response {
  if (outcome.unavailable) {
    return jsonError(
      503,
      "search_unavailable",
      "Ripgrep is not installed on this server; code search is unavailable."
    )
  }
  return Response.json({
    results: outcome.results,
    truncated: outcome.truncated,
  })
}

export function jsonError(
  status: number,
  error: string,
  message?: string,
  headers?: HeadersInit
): Response {
  const body: ApiErrorBody = message ? { error, message } : { error }
  return Response.json(body, { status, headers })
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

/**
 * Map filesystem errors from an evidence read to a controlled response.
 * Returning null means the caller should rethrow: unexpected errors must not
 * be turned into a misleading 404.
 */
export function evidenceErrnoResponse(error: unknown): Response | null {
  if (!isErrnoException(error)) {
    return null
  }
  switch (error.code) {
    case "EACCES":
    case "EPERM":
      return jsonError(403, "forbidden", "The evidence file is not readable.")
    case "ENOENT":
    case "ENOTDIR":
    case "EISDIR":
    case "ELOOP":
      return jsonError(404, "not_found", "The evidence file is not available.")
    default:
      return null
  }
}

const ENCODED_BYTE = /%[0-9a-f]{2}/i

/**
 * Reject a segment that still carries an encoded traversal after Next decoded
 * the dynamic params once. A literal `%20` file name is allowed; an encoded
 * slash, backslash or dot segment is not.
 */
function hasEncodedTraversal(segment: string): boolean {
  if (!ENCODED_BYTE.test(segment)) {
    return false
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    return false
  }
  return (
    decoded === "." ||
    decoded === ".." ||
    decoded.includes("/") ||
    decoded.includes("\\") ||
    decoded.includes("\u0000")
  )
}

/**
 * Validate and join the catch-all evidence path segments. Returns null for
 * traversal, absolute paths, NUL bytes, or an implausible segment count.
 * Next 16 already decodes dynamic params, so segments are validated as-is and
 * only re-decoded to detect double-encoded traversal.
 */
export function parsePathSegments(segments: readonly string[]): string | null {
  if (segments.length === 0 || segments.length > 64) {
    return null
  }
  const parts: string[] = []
  for (const segment of segments) {
    if (
      segment === "" ||
      segment === "." ||
      segment === ".." ||
      segment.length > 255 ||
      segment.includes("/") ||
      segment.includes("\\") ||
      segment.includes("\u0000") ||
      hasEncodedTraversal(segment)
    ) {
      return null
    }
    parts.push(segment)
  }
  const relative = parts.join("/")
  if (path.isAbsolute(relative)) {
    return null
  }
  return relative
}

export interface ContentTypeInfo {
  contentType: string
  disposition: "inline" | "attachment"
}

const TEXT_TYPES = new Set([
  ".txt",
  ".text",
  ".log",
  ".out",
  ".err",
  ".md",
  ".markdown",
  ".rst",
  ".py",
  ".pyi",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".sql",
  ".r",
  ".java",
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".hpp",
  ".go",
  ".rs",
  ".rb",
  ".php",
  ".lua",
  ".pl",
  ".tex",
  ".bib",
])

const INLINE_TYPES: Readonly<Record<string, string>> = {
  ".pdf": "application/pdf",
  ".json": "application/json; charset=utf-8",
  ".ipynb": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
}

/**
 * Allowlisted content types. Unknown or executable formats are served as
 * octet-stream attachments so the browser never renders them in our origin.
 */
export function contentTypeFor(fileName: string): ContentTypeInfo {
  const base = path.basename(fileName).toLowerCase()
  const extension = path.extname(base)

  // Dotfiles have no extension, so name them explicitly instead of letting
  // them fall through to the unknown-format attachment branch.
  if (base === ".gitignore" || base === ".dockerignore") {
    return { contentType: "text/plain; charset=utf-8", disposition: "inline" }
  }
  if (extension === ".md" || extension === ".markdown") {
    return {
      contentType: "text/markdown; charset=utf-8",
      disposition: "inline",
    }
  }
  if (TEXT_TYPES.has(extension)) {
    return { contentType: "text/plain; charset=utf-8", disposition: "inline" }
  }
  const type = INLINE_TYPES[extension]
  if (type) {
    return { contentType: type, disposition: "inline" }
  }
  return { contentType: "application/octet-stream", disposition: "attachment" }
}

function safeFilename(fileName: string): string {
  const base = path
    .basename(fileName)
    .replace(/[\u0000-\u001f\u007f"\\]/g, "_")
    .trim()
  return base === "" ? "download" : base
}

/** Header values are ByteStrings; non-ASCII names need an ASCII fallback. */
function asciiFallback(fileName: string): string {
  const base = fileName
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_")
    .trim()
  return base === "" ? "download" : base
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  )
}

export function contentDisposition(
  fileName: string,
  disposition: "inline" | "attachment"
): string {
  const base = safeFilename(fileName)
  return `${disposition}; filename="${asciiFallback(base)}"; filename*=UTF-8''${encodeRfc5987(base)}`
}

export type ParsedRange = { start: number; end: number }

/**
 * Parse a single `bytes=` range. Returns null when the header is absent and
 * "invalid" when it is malformed or unsatisfiable.
 */
export function parseRangeHeader(
  header: string | null,
  size: number
): ParsedRange | "invalid" | null {
  if (header === null || header.trim() === "") {
    return null
  }
  if (size <= 0 || !header.toLowerCase().startsWith("bytes=")) {
    return "invalid"
  }
  const spec = header.slice("bytes=".length).trim()
  if (spec === "" || spec.includes(",")) {
    return "invalid"
  }
  const match = /^(\d*)-(\d*)$/.exec(spec)
  if (!match) {
    return "invalid"
  }
  const [, rawStart, rawEnd] = match
  if (rawStart === "" && rawEnd === "") {
    return "invalid"
  }
  if (rawStart === "") {
    const suffix = Number(rawEnd)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) {
      return "invalid"
    }
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(rawStart)
  if (!Number.isSafeInteger(start) || start < 0 || start >= size) {
    return "invalid"
  }
  const end = rawEnd === "" ? size - 1 : Number(rawEnd)
  if (!Number.isSafeInteger(end) || end < start) {
    return "invalid"
  }
  return { start, end: Math.min(end, size - 1) }
}
