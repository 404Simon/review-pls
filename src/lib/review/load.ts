import { readFile, readdir, realpath, stat } from "node:fs/promises"
import path from "node:path"
import type { Dirent, Stats } from "node:fs"

import { z } from "zod"

import { buildReviewData } from "@/lib/review/build"
import { batchContentFingerprint, sha256Bytes } from "@/lib/review/hash"
import { isWithin } from "@/lib/review/paths"
import {
  batchSchema,
  findingsFileSchema,
  overlapSchema,
  paperMetadataSchema,
  type Batch,
  type ExcludedPaper,
  type Finding,
  type Overlap,
  type PaperManifest,
  type PaperMetadata,
  type PaperReview,
  type ReviewCounts,
  type ReviewItem,
  type ValidationIssue,
} from "@/lib/review/types"

export type ReviewDataErrorCode =
  | "ROOT_MISSING"
  | "BATCH_NOT_FOUND"
  | "PAPER_NOT_FOUND"
  | "FILE_NOT_FOUND"
  | "FILE_TOO_LARGE"
  | "INVALID_JSON"
  | "SCHEMA_INVALID"
  | "SHA_MISMATCH"
  | "PATH_ESCAPE"
  | "INVALID_MANIFEST"

/** JSON manifests are data, not evidence blobs. Keep loads bounded. */
export const MAX_JSON_FILE_BYTES = 16 * 1024 * 1024

export interface ReviewDataErrorDetails {
  path?: string
  batchId?: string
  paperId?: string
}

export class ReviewDataError extends Error {
  readonly code: ReviewDataErrorCode
  readonly details: ReviewDataErrorDetails

  constructor(
    code: ReviewDataErrorCode,
    message: string,
    details: ReviewDataErrorDetails = {}
  ) {
    super(message)
    this.name = "ReviewDataError"
    this.code = code
    this.details = details
  }
}

/** Unknown batch/paper ids are ordinary 404s, not mounted-data failures. */
export function isMissingReviewData(error: ReviewDataError): boolean {
  return error.code === "BATCH_NOT_FOUND" || error.code === "PAPER_NOT_FOUND"
}

export interface ReviewDataOptions {
  root?: string
}

export interface LoadedBatch {
  root: string
  dir: string
  manifest: Batch
  manifestSha256: string
  papers: PaperManifest[]
  excluded: ExcludedPaper[]
}

export interface LoadedPaper {
  manifest: PaperManifest
  dir: string
  overlap: Overlap
  agentFindings: Finding[]
  auditowlFindings: Finding[]
  paper: PaperMetadata
}

export interface LoadedItems {
  batch: LoadedBatch
  papers: PaperReview[]
  /**
   * Raw per-paper sources (overlap, both findings files and paper metadata).
   * The built `papers` only keep the domain projection; archival exports need
   * the complete source to stay re-analysable without the mount.
   */
  sources: LoadedPaper[]
  items: ReviewItem[]
  counts: ReviewCounts
  issues: ValidationIssue[]
  excluded: ExcludedPaper[]
}

export interface BatchSummary {
  batchId: string
  label: string
  generatedAt: string
  paperCount: number
  excludedCount: number
  manifestSha256?: string
  error?: string
}

interface CachedFile {
  mtimeMs: number
  size: number
  buffer: Buffer
  sha256: string
}

// Raw bytes are cached; parsing and schema validation run on every read. That
// keeps the cache safe when the same path is read with different schemas and
// when a file is replaced under an unchanged path.
const fileCache = new Map<string, CachedFile>()

function isWithinRoot(root: string, candidate: string): boolean {
  return isWithin(root, candidate)
}

function resolveWithin(
  root: string,
  relative: string,
  details: ReviewDataErrorDetails
): string {
  if (path.isAbsolute(relative)) {
    throw new ReviewDataError(
      "PATH_ESCAPE",
      `Absolute path is not allowed in the review manifest: ${relative}`,
      details
    )
  }
  const absolute = path.resolve(root, relative)
  if (!isWithinRoot(root, absolute)) {
    throw new ReviewDataError(
      "PATH_ESCAPE",
      `Path escapes its review data root: ${relative}`,
      details
    )
  }
  return absolute
}

function formatSchemaError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const location = issue.path.length > 0 ? issue.path.join(".") : "<root>"
      return `${location}: ${issue.message}`
    })
    .join("; ")
}

async function assertRealWithin(
  realRoot: string,
  absolutePath: string,
  description: string,
  details: ReviewDataErrorDetails
): Promise<void> {
  let real: string
  try {
    real = await realpath(absolutePath)
  } catch {
    throw new ReviewDataError(
      "FILE_NOT_FOUND",
      `${description} is missing: ${absolutePath}`,
      { ...details, path: absolutePath }
    )
  }
  if (!isWithinRoot(realRoot, real)) {
    throw new ReviewDataError(
      "PATH_ESCAPE",
      `${description} resolves outside the batch root: ${absolutePath}`,
      { ...details, path: absolutePath }
    )
  }
}

async function readJsonCached<S extends z.ZodType>(
  realRoot: string,
  absolutePath: string,
  schema: S,
  description: string,
  details: ReviewDataErrorDetails
): Promise<{ data: z.infer<S>; sha256: string }> {
  let info: Stats
  try {
    info = await stat(absolutePath)
  } catch {
    throw new ReviewDataError(
      "FILE_NOT_FOUND",
      `${description} is missing: ${absolutePath}`,
      { ...details, path: absolutePath }
    )
  }
  if (!info.isFile()) {
    throw new ReviewDataError(
      "FILE_NOT_FOUND",
      `${description} is not a file: ${absolutePath}`,
      { ...details, path: absolutePath }
    )
  }
  if (info.size > MAX_JSON_FILE_BYTES) {
    throw new ReviewDataError(
      "FILE_TOO_LARGE",
      `${description} is larger than ${MAX_JSON_FILE_BYTES} bytes: ${absolutePath}`,
      { ...details, path: absolutePath }
    )
  }
  await assertRealWithin(realRoot, absolutePath, description, details)

  let cached = fileCache.get(absolutePath)
  if (!cached || cached.mtimeMs !== info.mtimeMs || cached.size !== info.size) {
    const buffer = await readFile(absolutePath)
    cached = {
      mtimeMs: info.mtimeMs,
      size: info.size,
      buffer,
      sha256: sha256Bytes(buffer),
    }
    fileCache.set(absolutePath, cached)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(cached.buffer.toString("utf8")) as unknown
  } catch {
    throw new ReviewDataError(
      "INVALID_JSON",
      `${description} is not valid JSON: ${absolutePath}`,
      { ...details, path: absolutePath }
    )
  }

  const result = schema.safeParse(parsed)
  if (!result.success) {
    throw new ReviewDataError(
      "SCHEMA_INVALID",
      `${description} does not match the schema: ${absolutePath} (${formatSchemaError(result.error)})`,
      { ...details, path: absolutePath }
    )
  }

  return { data: result.data, sha256: cached.sha256 }
}

function assertSha256(
  expected: string,
  actual: string,
  fileLabel: string,
  details: ReviewDataErrorDetails
): void {
  if (expected !== actual) {
    throw new ReviewDataError(
      "SHA_MISMATCH",
      `${fileLabel} sha256 does not match batch.json (expected ${expected}, got ${actual})`,
      details
    )
  }
}

async function assertDirectory(
  absolutePath: string,
  description: string,
  details: ReviewDataErrorDetails
): Promise<void> {
  let info: Stats
  try {
    info = await stat(absolutePath)
  } catch {
    throw new ReviewDataError(
      "FILE_NOT_FOUND",
      `${description} is missing: ${absolutePath}`,
      { ...details, path: absolutePath }
    )
  }
  if (!info.isDirectory()) {
    throw new ReviewDataError(
      "FILE_NOT_FOUND",
      `${description} is not a directory: ${absolutePath}`,
      { ...details, path: absolutePath }
    )
  }
}

async function assertFile(
  absolutePath: string,
  description: string,
  details: ReviewDataErrorDetails
): Promise<void> {
  let info: Stats
  try {
    info = await stat(absolutePath)
  } catch {
    throw new ReviewDataError(
      "FILE_NOT_FOUND",
      `${description} is missing: ${absolutePath}`,
      { ...details, path: absolutePath }
    )
  }
  if (!info.isFile()) {
    throw new ReviewDataError(
      "FILE_NOT_FOUND",
      `${description} is not a file: ${absolutePath}`,
      { ...details, path: absolutePath }
    )
  }
}

function resolveRoot(options?: ReviewDataOptions): string {
  const root = options?.root ?? process.env.REVIEW_DATA_ROOT
  if (!root || root.trim() === "") {
    throw new ReviewDataError(
      "ROOT_MISSING",
      "REVIEW_DATA_ROOT is not set and no root was provided"
    )
  }
  return path.resolve(root)
}

function assertBatchId(batchId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(batchId)) {
    throw new ReviewDataError(
      "BATCH_NOT_FOUND",
      `Invalid batch id: ${JSON.stringify(batchId)}`
    )
  }
}

function validateManifest(manifest: Batch, batchId: string): void {
  if (manifest.batchId !== batchId) {
    throw new ReviewDataError(
      "INVALID_MANIFEST",
      `batch.json declares batchId ${JSON.stringify(manifest.batchId)} but is stored under ${JSON.stringify(batchId)}`,
      { batchId }
    )
  }
  const paperIds = new Set<string>()
  for (const paper of manifest.papers) {
    if (paperIds.has(paper.id)) {
      throw new ReviewDataError(
        "INVALID_MANIFEST",
        `batch.json lists paper ${paper.id} more than once`,
        { batchId, paperId: paper.id }
      )
    }
    paperIds.add(paper.id)
  }
  for (const excluded of manifest.excluded) {
    if (paperIds.has(excluded.paperId)) {
      throw new ReviewDataError(
        "INVALID_MANIFEST",
        `paper ${excluded.paperId} is both included and excluded`,
        { batchId, paperId: excluded.paperId }
      )
    }
  }
  const fingerprint = batchContentFingerprint(manifest)
  if (manifest.contentSha256 !== fingerprint) {
    throw new ReviewDataError(
      "INVALID_MANIFEST",
      `batch.json contentSha256 does not match its content (expected ${fingerprint}, got ${manifest.contentSha256})`,
      { batchId }
    )
  }
}

async function loadPaperFromBatch(
  batch: LoadedBatch,
  manifest: PaperManifest
): Promise<LoadedPaper> {
  const details = { batchId: batch.manifest.batchId, paperId: manifest.id }
  const realBatchRoot = await realpath(batch.dir)
  const paperDir = resolveWithin(batch.dir, manifest.dir, details)
  await assertDirectory(paperDir, "paper directory", details)
  await assertRealWithin(realBatchRoot, paperDir, "paper directory", details)

  const overlapPath = resolveWithin(paperDir, manifest.files.overlap, details)
  const agentPath = resolveWithin(
    paperDir,
    manifest.files.agentFindings,
    details
  )
  const auditowlPath = resolveWithin(
    paperDir,
    manifest.files.auditowlFindings,
    details
  )
  const paperPath = resolveWithin(paperDir, manifest.files.paper, details)

  const overlapFile = await readJsonCached(
    realBatchRoot,
    overlapPath,
    overlapSchema,
    "overlap.json",
    details
  )
  const agentFile = await readJsonCached(
    realBatchRoot,
    agentPath,
    findingsFileSchema,
    "agent findings",
    details
  )
  const auditowlFile = await readJsonCached(
    realBatchRoot,
    auditowlPath,
    findingsFileSchema,
    "AuditOwl findings",
    details
  )
  const paperFile = await readJsonCached(
    realBatchRoot,
    paperPath,
    paperMetadataSchema,
    "paper.json",
    details
  )

  assertSha256(
    manifest.sha256.overlap,
    overlapFile.sha256,
    "overlap.json",
    details
  )
  assertSha256(
    manifest.sha256.agentFindings,
    agentFile.sha256,
    "findings.agent.json",
    details
  )
  assertSha256(
    manifest.sha256.auditowlFindings,
    auditowlFile.sha256,
    "findings.auditowl.json",
    details
  )

  const paperTextPath = resolveWithin(
    paperDir,
    manifest.files.paperText,
    details
  )
  const paperPdfPath = resolveWithin(paperDir, manifest.files.paperPdf, details)
  await assertFile(paperTextPath, "paper text", details)
  await assertRealWithin(realBatchRoot, paperTextPath, "paper text", details)
  await assertFile(paperPdfPath, "paper PDF", details)
  await assertRealWithin(realBatchRoot, paperPdfPath, "paper PDF", details)

  const runDir = resolveWithin(paperDir, manifest.files.agentRun, details)
  const auditowlDir = resolveWithin(
    paperDir,
    manifest.files.auditowlDir,
    details
  )
  await assertDirectory(runDir, "agent run directory", details)
  await assertRealWithin(realBatchRoot, runDir, "agent run directory", details)
  await assertDirectory(auditowlDir, "AuditOwl directory", details)
  await assertRealWithin(
    realBatchRoot,
    auditowlDir,
    "AuditOwl directory",
    details
  )

  for (const repo of manifest.code) {
    const repoDir = resolveWithin(paperDir, repo.dir, details)
    await assertDirectory(repoDir, `code repository ${repo.name}`, details)
    await assertRealWithin(
      realBatchRoot,
      repoDir,
      `code repository ${repo.name}`,
      details
    )
  }

  return {
    manifest,
    dir: paperDir,
    overlap: overlapFile.data,
    agentFindings: agentFile.data.findings,
    auditowlFindings: auditowlFile.data.findings,
    paper: paperFile.data,
  }
}

export async function listBatches(
  options?: ReviewDataOptions
): Promise<BatchSummary[]> {
  const root = resolveRoot(options)
  let entries: Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    throw new ReviewDataError(
      "ROOT_MISSING",
      `Review data root does not exist or is not readable: ${root}`,
      { path: root }
    )
  }

  const batchIds = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

  const summaries: BatchSummary[] = []
  for (const batchId of batchIds) {
    try {
      const batch = await loadBatch(batchId, { root })
      summaries.push({
        batchId,
        label: batch.manifest.label,
        generatedAt: batch.manifest.generatedAt,
        paperCount: batch.papers.length,
        excludedCount: batch.excluded.length,
        manifestSha256: batch.manifestSha256,
      })
    } catch (error) {
      if (!(error instanceof ReviewDataError)) {
        throw error
      }
      if (error.code === "BATCH_NOT_FOUND") {
        continue
      }
      summaries.push({
        batchId,
        label: batchId,
        generatedAt: "",
        paperCount: 0,
        excludedCount: 0,
        error: error.message,
      })
    }
  }
  return summaries
}

export async function loadBatch(
  batchId: string,
  options?: ReviewDataOptions
): Promise<LoadedBatch> {
  assertBatchId(batchId)
  const root = resolveRoot(options)
  const dir = resolveWithin(root, batchId, { batchId })
  if (!(await isDirectory(dir))) {
    throw new ReviewDataError(
      "BATCH_NOT_FOUND",
      `Batch directory is missing: ${dir}`,
      { batchId, path: dir }
    )
  }
  const realRoot = await realpath(root)
  await assertRealWithin(realRoot, dir, "batch directory", { batchId })
  const realBatchDir = await realpath(dir)

  const manifestPath = path.join(dir, "batch.json")
  const manifestFile = await readJsonCached(
    realBatchDir,
    manifestPath,
    batchSchema,
    "batch.json",
    { batchId }
  )
  validateManifest(manifestFile.data, batchId)

  return {
    root,
    dir,
    manifest: manifestFile.data,
    manifestSha256: batchContentFingerprint(manifestFile.data),
    papers: manifestFile.data.papers,
    excluded: manifestFile.data.excluded,
  }
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory()
  } catch {
    return false
  }
}

export async function loadPaper(
  batchId: string,
  paperId: string,
  options?: ReviewDataOptions
): Promise<LoadedPaper> {
  const batch = await loadBatch(batchId, options)
  const manifest = batch.papers.find((paper) => paper.id === paperId)
  if (!manifest) {
    throw new ReviewDataError(
      "PAPER_NOT_FOUND",
      `Paper ${JSON.stringify(paperId)} is not part of batch ${JSON.stringify(batchId)}`,
      { batchId, paperId }
    )
  }
  return loadPaperFromBatch(batch, manifest)
}

export async function loadItems(
  batchId: string,
  options?: ReviewDataOptions
): Promise<LoadedItems> {
  const batch = await loadBatch(batchId, options)
  const papers = await Promise.all(
    batch.papers.map((manifest) => loadPaperFromBatch(batch, manifest))
  )
  const built = buildReviewData({
    papers: papers.map((paper) => ({
      manifest: paper.manifest,
      overlap: paper.overlap,
      agentFindings: paper.agentFindings,
      auditowlFindings: paper.auditowlFindings,
    })),
    excluded: batch.excluded,
  })

  return {
    batch,
    papers: built.papers,
    sources: papers,
    items: built.items,
    counts: built.counts,
    issues: built.issues,
    excluded: built.excluded,
  }
}

export function clearReviewDataCache(): void {
  fileCache.clear()
}
