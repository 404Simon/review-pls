import { spawn, type ChildProcess } from "node:child_process"
import { open, readdir, realpath, stat } from "node:fs/promises"
import path from "node:path"
import type { Dirent, Stats } from "node:fs"

import { z } from "zod"

import {
  hasTraversal,
  isIgnoredEntry,
  isIgnoredRelativePath,
  isWithin,
  joinWithin,
} from "@/lib/review/paths"
import {
  resolveEvidence,
  type QuoteMatch,
  type ResolutionAttempt,
  type ResolveRoots,
} from "@/lib/review/resolve"
import type {
  EvidenceSide,
  ItemKind,
  PaperManifest,
  ReviewFinding,
  ReviewItem,
  Severity,
} from "@/lib/review/types"

export const CODE_CONTEXT_LINES = 40
export const MAX_CODE_LINES = 400
export const MAX_CODE_LINE_CHARS = 500
export const MAX_CODE_FILE_BYTES = 1024 * 1024
export const MAX_CLOSEST_MATCHES = 5
const MAX_CLOSEST_SCAN = 2000
export const MAX_CHECK_FILE_BYTES = 200 * 1024
export const MAX_CHECK_TEXT_LINES = 400
export const MAX_CSV_ROWS = 100
export const MAX_JSON_LINES = 200
export const MAX_FINDINGS_PER_SIDE = 10
export const MAX_CHECKS_PER_FINDING = 5
export const MAX_PAPER_CONTEXTS = 3
export const PAPER_CONTEXT_RADIUS = 200
export const REPORT_CONTEXT_LINES = 40
export const MAX_TREE_ENTRIES = 5000
export const MAX_SEARCH_RESULTS_PER_REPO = 20
export const MAX_PAPER_SEARCH_RESULTS = 50
export const RG_TIMEOUT_MS = 5000

export { isIgnoredEntry, isIgnoredRelativePath } from "@/lib/review/paths"

const BINARY_EXTENSIONS = new Set([
  ".7z",
  ".a",
  ".avi",
  ".bin",
  ".bz2",
  ".ckpt",
  ".dll",
  ".dylib",
  ".exe",
  ".flac",
  ".gif",
  ".gz",
  ".h5",
  ".hdf5",
  ".ico",
  ".jpeg",
  ".jpg",
  ".mat",
  ".mkv",
  ".mov",
  ".mp3",
  ".mp4",
  ".npy",
  ".npz",
  ".o",
  ".onnx",
  ".otf",
  ".pkl",
  ".pickle",
  ".png",
  ".pt",
  ".pth",
  ".pyc",
  ".sif",
  ".so",
  ".tar",
  ".tgz",
  ".ttf",
  ".wav",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
  ".xz",
  ".zip",
])

export function isBinaryPath(fileName: string): boolean {
  return BINARY_EXTENSIONS.has(path.extname(fileName).toLowerCase())
}

export const RG_EXCLUDES = [
  "!**/.git/**",
  "!**/node_modules/**",
  "!**/__pycache__/**",
  "!**/.venv/**",
  "!**/*.pyc",
  "!**/*.sif",
  "!**/trajectory.json",
  "!**/.env*",
  "!**/.DS_Store",
] as const

export interface EvidenceRepoRoot {
  name: string
  dir: string
  commit: string | null
}

export interface EvidenceRoots {
  batchRoot: string
  paperDir: string
  repos: EvidenceRepoRoot[]
  runDir: string | null
  auditowlDir: string | null
  paperTextPath: string | null
  pdfPath: string | null
  agentReportPath: string | null
  auditowlReportPath: string | null
}

interface PaperLike {
  manifest: PaperManifest
  dir: string
}

export function evidenceRootsFromPaper(
  batchRoot: string,
  paper: PaperLike
): EvidenceRoots {
  const resolveDir = (relative: string | null | undefined): string | null => {
    if (!relative) {
      return null
    }
    return joinWithin(paper.dir, relative)
  }
  const runDir = resolveDir(paper.manifest.files.agentRun)
  const auditowlDir = resolveDir(paper.manifest.files.auditowlDir)
  return {
    batchRoot,
    paperDir: paper.dir,
    repos: paper.manifest.code.flatMap((repo) => {
      const dir = resolveDir(repo.dir)
      return dir ? [{ name: repo.name, dir, commit: repo.commit }] : []
    }),
    runDir,
    auditowlDir,
    paperTextPath: resolveDir(paper.manifest.files.paperText),
    pdfPath: resolveDir(paper.manifest.files.paperPdf),
    agentReportPath: runDir ? path.join(runDir, "audit.md") : null,
    auditowlReportPath: auditowlDir ? path.join(auditowlDir, "audit.md") : null,
  }
}

function resolveRoots(roots: EvidenceRoots): ResolveRoots {
  return {
    batchRoot: roots.batchRoot,
    paperDir: roots.paperDir,
    repos: roots.repos.map((repo) => ({ name: repo.name, dir: repo.dir })),
    runDir: roots.runDir,
    auditowlDir: roots.auditowlDir,
  }
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/")
}

export function toPaperRelative(
  paperDir: string,
  absolutePath: string
): string | null {
  const relative = path.relative(paperDir, absolutePath)
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return null
  }
  return toPosix(relative)
}

function encodeRelativePath(relative: string): string {
  return relative.split("/").map(encodeURIComponent).join("/")
}

export function evidenceFileUrl(
  batchId: string,
  paperId: string,
  relative: string
): string {
  return `/api/evidence/${encodeURIComponent(batchId)}/${encodeURIComponent(paperId)}/${encodeRelativePath(relative)}`
}

export function evidenceTreeUrl(
  batchId: string,
  paperId: string,
  scope: "code" | "paper" | "run" | "auditowl"
): string {
  return `/api/tree?batch=${encodeURIComponent(batchId)}&paper=${encodeURIComponent(paperId)}&scope=${scope}`
}

export function evidenceSearchUrl(
  batchId: string,
  paperId: string,
  scope: "code" | "paper",
  query: string
): string {
  return `/api/search?batch=${encodeURIComponent(batchId)}&paper=${encodeURIComponent(paperId)}&scope=${scope}&q=${encodeURIComponent(query)}`
}

export function sanitizeAttempts(
  attempts: readonly ResolutionAttempt[],
  paperDir: string
): ResolutionAttempt[] {
  return attempts.map((attempt) => {
    if (attempt.path === "") {
      return attempt
    }
    const relative = toPaperRelative(paperDir, attempt.path)
    if (relative !== null) {
      return { ...attempt, path: relative }
    }
    const lexical = path.relative(paperDir, attempt.path)
    if (
      lexical === ".." ||
      lexical.startsWith(`..${path.sep}`) ||
      path.isAbsolute(lexical)
    ) {
      return { ...attempt, path: "<outside the paper directory>" }
    }
    return { ...attempt, path: "<unresolved>" }
  })
}

export interface CodeLine {
  number: number
  text: string
  cited: boolean
}

export interface CodePreview {
  startLine: number
  endLine: number
  totalLines: number
  lines: CodeLine[]
  truncated: boolean
}

function truncateLine(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
}

export function buildCodePreview(
  text: string,
  lineStart: number | null,
  lineEnd: number | null,
  options: {
    context?: number
    maxLines?: number
    maxLineChars?: number
    sourceTruncated?: boolean
  } = {}
): CodePreview {
  const context = options.context ?? CODE_CONTEXT_LINES
  const maxLines = options.maxLines ?? MAX_CODE_LINES
  const maxLineChars = options.maxLineChars ?? MAX_CODE_LINE_CHARS
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop()
  }
  const totalLines = lines.length
  if (totalLines === 0) {
    return {
      startLine: 1,
      endLine: 0,
      totalLines: 0,
      lines: [],
      truncated: options.sourceTruncated ?? false,
    }
  }

  const citedStart = lineStart !== null && lineStart > 0 ? lineStart : null
  const citedEnd =
    citedStart === null ? null : Math.max(lineEnd ?? citedStart, citedStart)
  // A citation past EOF is not a citation. Show the end of the file but do
  // not highlight a line the finding did not actually point at.
  const citationExists = citedStart !== null && citedStart <= totalLines

  let startLine: number
  let endLine: number
  if (citedStart === null) {
    startLine = 1
    endLine = Math.min(totalLines, Math.max(context * 2, 1))
  } else {
    const anchor = Math.min(citedStart, totalLines)
    startLine = Math.max(1, anchor - context)
    const lastCited = Math.min(citedEnd ?? citedStart, totalLines)
    endLine = Math.min(totalLines, lastCited + context)
    if (endLine - startLine + 1 > maxLines) {
      endLine = startLine + maxLines - 1
    }
  }

  const previewLines: CodeLine[] = []
  for (let number = startLine; number <= endLine; number += 1) {
    previewLines.push({
      number,
      text: truncateLine(lines[number - 1] ?? "", maxLineChars),
      cited:
        citationExists &&
        citedStart !== null &&
        citedEnd !== null &&
        number >= citedStart &&
        number <= citedEnd,
    })
  }

  return {
    startLine,
    endLine,
    totalLines,
    lines: previewLines,
    truncated:
      (options.sourceTruncated ?? false) ||
      (citationExists && citedEnd !== null && citedEnd > endLine),
  }
}

interface CappedRead {
  text: string
  size: number
  truncated: boolean
  binary: boolean
}

async function readCapped(
  absolutePath: string,
  maxBytes: number
): Promise<CappedRead | null> {
  let info: Stats
  try {
    info = await stat(absolutePath)
  } catch {
    return null
  }
  if (!info.isFile()) {
    return null
  }
  const length = Math.min(info.size, maxBytes)
  let buffer: Buffer
  try {
    const handle = await open(absolutePath, "r")
    try {
      buffer = Buffer.alloc(length)
      if (length > 0) {
        await handle.read(buffer, 0, length, 0)
      }
    } finally {
      await handle.close()
    }
  } catch {
    return null
  }
  return {
    text: buffer.toString("utf8"),
    size: info.size,
    truncated: info.size > maxBytes,
    binary: buffer.includes(0),
  }
}

export interface ClosestMatch {
  path: string
  url: string
}

export interface CodeEvidence {
  raw: string
  kind: "file" | "check" | "paper" | "url" | "missing"
  relativePath: string | null
  fileUrl: string | null
  externalUrl: string | null
  repo: string | null
  commit: string | null
  lineStart: number | null
  lineEnd: number | null
  quote: string | null
  quoteMatch: QuoteMatch
  note: string | null
  missingAttempts: ResolutionAttempt[]
  closestMatches: ClosestMatch[]
  preview: CodePreview | null
  treeUrl: string | null
  searchUrl: string | null
}

function repoForPath(
  roots: EvidenceRoots,
  absolutePath: string
): EvidenceRepoRoot | null {
  for (const repo of roots.repos) {
    if (isWithin(repo.dir, absolutePath)) {
      return repo
    }
  }
  return null
}

interface ClosestScan {
  matches: string[]
  visited: number
}

async function collectClosestByBasename(
  directory: string,
  basename: string,
  scan: ClosestScan
): Promise<void> {
  if (
    scan.matches.length >= MAX_CLOSEST_MATCHES ||
    scan.visited >= MAX_CLOSEST_SCAN
  ) {
    return
  }
  let entries: Dirent[]
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return
  }
  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    if (
      scan.matches.length >= MAX_CLOSEST_MATCHES ||
      scan.visited >= MAX_CLOSEST_SCAN
    ) {
      return
    }
    if (isIgnoredEntry(entry.name) || entry.isSymbolicLink()) {
      continue
    }
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      await collectClosestByBasename(absolute, basename, scan)
    } else if (entry.isFile()) {
      scan.visited += 1
      if (entry.name === basename) {
        scan.matches.push(absolute)
      }
    }
  }
}

async function collectSiblingMatches(
  directory: string,
  extension: string,
  scan: ClosestScan
): Promise<void> {
  if (scan.matches.length >= MAX_CLOSEST_MATCHES) {
    return
  }
  let entries: Dirent[]
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return
  }
  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    if (scan.matches.length >= MAX_CLOSEST_MATCHES) {
      return
    }
    if (
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      isIgnoredEntry(entry.name)
    ) {
      continue
    }
    if (extension !== "" && !entry.name.endsWith(extension)) {
      continue
    }
    scan.matches.push(path.join(directory, entry.name))
  }
}

async function closestMatchesFor(
  roots: EvidenceRoots,
  raw: string,
  attempts: readonly ResolutionAttempt[],
  batchId: string,
  paperId: string
): Promise<ClosestMatch[]> {
  const basename = path.posix.basename(raw.replace(/\\/g, "/"))
  if (basename === "") {
    return []
  }
  const scan: ClosestScan = { matches: [], visited: 0 }
  for (const repo of roots.repos) {
    await collectClosestByBasename(repo.dir, basename, scan)
    if (scan.matches.length >= MAX_CLOSEST_MATCHES) {
      break
    }
  }
  if (scan.matches.length === 0) {
    const extension = path.posix.extname(basename).toLowerCase()
    const parents = new Set<string>()
    for (const attempt of attempts) {
      if (attempt.outcome !== "miss" || attempt.path === "") {
        continue
      }
      const parent = path.dirname(attempt.path)
      if (parent !== roots.paperDir && isWithin(roots.paperDir, parent)) {
        parents.add(parent)
      }
    }
    for (const parent of [...parents].sort()) {
      await collectSiblingMatches(parent, extension, scan)
      if (scan.matches.length >= MAX_CLOSEST_MATCHES) {
        break
      }
    }
  }

  const seen = new Set<string>()
  const matches: ClosestMatch[] = []
  for (const absolute of scan.matches) {
    const relative = toPaperRelative(roots.paperDir, absolute)
    if (relative === null || seen.has(relative)) {
      continue
    }
    seen.add(relative)
    matches.push({
      path: relative,
      url: evidenceFileUrl(batchId, paperId, relative),
    })
    if (matches.length >= MAX_CLOSEST_MATCHES) {
      break
    }
  }
  return matches
}

async function buildCodeEvidence(
  finding: ReviewFinding,
  side: EvidenceSide,
  roots: EvidenceRoots,
  batchId: string,
  paperId: string
): Promise<CodeEvidence> {
  const resolved = await resolveEvidence({
    roots: resolveRoots(roots),
    side,
    finding: {
      file: finding.file,
      quote: finding.quote,
      lineStart: finding.lineStart,
      lineEnd: finding.lineEnd,
    },
  })
  const base = {
    raw: finding.file,
    lineStart: resolved.lineStart,
    lineEnd: resolved.lineEnd,
    quote: finding.quote,
    quoteMatch: resolved.quoteMatch,
    missingAttempts: sanitizeAttempts(resolved.attempts, roots.paperDir),
    note: resolved.note,
  }

  if (resolved.kind === "url") {
    return {
      ...base,
      kind: "url",
      relativePath: null,
      fileUrl: null,
      externalUrl: resolved.url,
      repo: null,
      commit: null,
      closestMatches: [],
      preview: null,
      treeUrl: null,
      searchUrl: null,
    }
  }

  if (!resolved.absolutePath) {
    return {
      ...base,
      kind: "missing",
      relativePath: null,
      fileUrl: null,
      externalUrl: null,
      repo: null,
      commit: null,
      closestMatches: await closestMatchesFor(
        roots,
        finding.file,
        resolved.attempts,
        batchId,
        paperId
      ),
      preview: null,
      treeUrl: evidenceTreeUrl(batchId, paperId, "code"),
      searchUrl: evidenceSearchUrl(
        batchId,
        paperId,
        "code",
        path.posix.basename(finding.file)
      ),
    }
  }

  const absolutePath = resolved.absolutePath
  const relative = toPaperRelative(roots.paperDir, absolutePath)
  const repo = repoForPath(roots, absolutePath)
  if (relative === null) {
    return {
      ...base,
      kind: "missing",
      relativePath: null,
      fileUrl: null,
      externalUrl: null,
      repo: repo?.name ?? null,
      commit: repo?.commit ?? null,
      closestMatches: await closestMatchesFor(
        roots,
        finding.file,
        resolved.attempts,
        batchId,
        paperId
      ),
      preview: null,
      note: "the file resolves outside the paper directory",
      treeUrl: evidenceTreeUrl(batchId, paperId, "code"),
      searchUrl: evidenceSearchUrl(
        batchId,
        paperId,
        "code",
        path.posix.basename(finding.file)
      ),
    }
  }

  const read = await readCapped(absolutePath, MAX_CODE_FILE_BYTES)
  const preview =
    read === null || read.binary
      ? null
      : buildCodePreview(read.text, resolved.lineStart, resolved.lineEnd, {
          context: CODE_CONTEXT_LINES,
          maxLines: MAX_CODE_LINES,
          maxLineChars: MAX_CODE_LINE_CHARS,
          sourceTruncated: read.truncated,
        })

  return {
    ...base,
    kind: resolved.kind,
    relativePath: relative,
    fileUrl: evidenceFileUrl(batchId, paperId, relative),
    externalUrl: null,
    repo: repo?.name ?? null,
    commit: repo?.commit ?? null,
    closestMatches: [],
    preview,
    note:
      read === null
        ? "the file could not be read"
        : read.binary
          ? "the file looks binary; download it to inspect it"
          : (resolved.note ??
            (read.truncated
              ? "the file is larger than 1 MB; only an excerpt is shown"
              : null)),
    treeUrl: evidenceTreeUrl(batchId, paperId, "code"),
    searchUrl: evidenceSearchUrl(
      batchId,
      paperId,
      "code",
      path.posix.basename(finding.file)
    ),
  }
}

export interface CsvRow {
  cells: string[]
  highlight: boolean
}

export interface CsvTable {
  columns: string[]
  rows: CsvRow[]
  totalRows: number
  truncated: boolean
}

/** RFC 4180 CSV parser: quoted fields, escaped quotes, CRLF and embedded newlines. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "")
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        field += character
      }
      continue
    }
    if (character === '"' && field === "") {
      quoted = true
    } else if (character === ",") {
      row.push(field)
      field = ""
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") {
        index += 1
      }
      row.push(field)
      field = ""
      rows.push(row)
      row = []
    } else {
      field += character
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function referenceMatches(
  reference: string,
  file: string,
  lineStart: number | null,
  lineEnd: number | null
): boolean {
  const ref = reference.replace(/\\/g, "/").trim().toLowerCase()
  const target = file.replace(/\\/g, "/").trim().toLowerCase()
  if (ref === "" || target === "") {
    return false
  }
  const basename = path.posix.basename(target)
  if (!ref.includes(basename) && !ref.includes(target)) {
    return false
  }
  if (lineStart === null) {
    return true
  }
  const base = path.posix.basename(target)
  const tail = ref.slice(ref.lastIndexOf(base))
  const range = /(\d+)(?:\s*[-\u2013\u2014]\s*(\d+))?/.exec(tail)
  if (!range) {
    return true
  }
  const referenceStart = Number(range[1])
  const referenceEnd = range[2] ? Number(range[2]) : referenceStart
  const findingEnd = lineEnd ?? lineStart
  return referenceStart <= findingEnd && referenceEnd >= lineStart
}

export function buildCsvTable(
  text: string,
  match: { file: string; lineStart: number | null; lineEnd: number | null }
): CsvTable {
  const parsed = parseCsv(text)
  if (parsed.length === 0) {
    return { columns: [], rows: [], totalRows: 0, truncated: false }
  }
  const columns = parsed[0]
  const dataRows = parsed
    .slice(1)
    .filter((cells) => cells.some((cell) => cell.trim() !== ""))
  const referenceIndex = columns.findIndex((column) =>
    ["reference", "file", "path"].includes(column.trim().toLowerCase())
  )
  const rows = dataRows.slice(0, MAX_CSV_ROWS).map((cells) => ({
    cells,
    highlight:
      referenceIndex >= 0 &&
      referenceMatches(
        cells[referenceIndex] ?? "",
        match.file,
        match.lineStart,
        match.lineEnd
      ),
  }))
  return {
    columns,
    rows,
    totalRows: dataRows.length,
    truncated: dataRows.length > MAX_CSV_ROWS,
  }
}

export type CheckFormat =
  "csv" | "json" | "markdown" | "text" | "binary" | "url" | "missing"

export interface CheckEvidence {
  label: string
  raw: string
  resolved: boolean
  format: CheckFormat
  url: string | null
  size: number | null
  truncated: boolean
  note: string | null
  missingAttempts: ResolutionAttempt[]
  csv: CsvTable | null
  text: string | null
}

function capTextLines(
  text: string,
  maxLines: number
): { text: string; truncated: boolean } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  if (lines.length <= maxLines) {
    return { text, truncated: false }
  }
  return { text: lines.slice(0, maxLines).join("\n"), truncated: true }
}

function formatCheckText(
  text: string,
  extension: string,
  match: { file: string; lineStart: number | null; lineEnd: number | null }
): {
  format: CheckFormat
  csv: CsvTable | null
  text: string | null
  truncated: boolean
} {
  if (extension === ".csv") {
    const csv = buildCsvTable(text, match)
    return {
      format: "csv",
      csv,
      text: null,
      truncated: csv.truncated,
    }
  }
  if (extension === ".json") {
    let pretty = text
    try {
      pretty = JSON.stringify(JSON.parse(text) as unknown, null, 2)
    } catch {
      pretty = text
    }
    const capped = capTextLines(pretty, MAX_JSON_LINES)
    return {
      format: "json",
      csv: null,
      text: capped.text,
      truncated: capped.truncated,
    }
  }
  const capped = capTextLines(text, MAX_CHECK_TEXT_LINES)
  return {
    format:
      extension === ".md" || extension === ".markdown" ? "markdown" : "text",
    csv: null,
    text: capped.text,
    truncated: capped.truncated,
  }
}

async function buildCheckEvidence(
  raw: string,
  finding: ReviewFinding,
  side: EvidenceSide,
  roots: EvidenceRoots,
  batchId: string,
  paperId: string
): Promise<CheckEvidence> {
  const label = path.posix.basename(raw.replace(/\\/g, "/")) || raw
  const resolved = await resolveEvidence({
    roots: resolveRoots(roots),
    side,
    finding: { file: raw },
  })
  const missing = (
    note: string,
    attempts: ResolutionAttempt[]
  ): CheckEvidence => ({
    label,
    raw,
    resolved: false,
    format: "missing",
    url: null,
    size: null,
    truncated: false,
    note,
    missingAttempts: sanitizeAttempts(attempts, roots.paperDir),
    csv: null,
    text: null,
  })

  if (resolved.kind === "url") {
    return {
      label,
      raw,
      resolved: false,
      format: "url",
      url: resolved.url,
      size: null,
      truncated: false,
      note: "external URL artifact; it is not stored in this batch",
      missingAttempts: [],
      csv: null,
      text: null,
    }
  }
  if (!resolved.absolutePath) {
    return missing(resolved.note ?? "artifact not found", resolved.attempts)
  }

  const relative = toPaperRelative(roots.paperDir, resolved.absolutePath)
  if (relative === null) {
    return missing(
      "the artifact resolves outside the paper directory",
      resolved.attempts
    )
  }
  const url = evidenceFileUrl(batchId, paperId, relative)
  const read = await readCapped(resolved.absolutePath, MAX_CHECK_FILE_BYTES)
  if (read === null) {
    return {
      ...missing("the artifact could not be read", resolved.attempts),
      url,
    }
  }
  if (read.binary || isBinaryPath(label)) {
    return {
      label,
      raw,
      resolved: true,
      format: "binary",
      url,
      size: read.size,
      truncated: read.truncated,
      note: "binary artifact; download it to inspect it",
      missingAttempts: [],
      csv: null,
      text: null,
    }
  }

  const formatted = formatCheckText(
    read.text,
    path.extname(label).toLowerCase(),
    {
      file: finding.file,
      lineStart: finding.lineStart,
      lineEnd: finding.lineEnd,
    }
  )

  return {
    label,
    raw,
    resolved: true,
    format: formatted.format,
    url,
    size: read.size,
    truncated: read.truncated || formatted.truncated,
    note: read.truncated
      ? "the artifact is larger than 200 KB; only an excerpt is shown"
      : null,
    missingAttempts: [],
    csv: formatted.csv,
    text: formatted.text,
  }
}

function checkReferences(finding: ReviewFinding): string[] {
  const refs: string[] = []
  const add = (value: string | null | undefined): void => {
    if (!value) {
      return
    }
    const trimmed = value.trim()
    if (trimmed !== "" && !refs.includes(trimmed)) {
      refs.push(trimmed)
    }
  }
  add(finding.checkScript)
  for (const checked of finding.verification?.checked ?? []) {
    add(checked)
  }
  for (const crossRef of finding.crossRefs) {
    const normalized = crossRef.replace(/\\/g, "/")
    if (
      normalized.startsWith("out/") ||
      normalized.includes("/out/") ||
      normalized.startsWith("_audit_code/") ||
      normalized.includes("/_audit_code/") ||
      normalized.includes("_verifier_code")
    ) {
      add(crossRef)
    }
  }
  return refs.slice(0, MAX_CHECKS_PER_FINDING)
}

export function parsePaperPages(
  reference: string | null | undefined
): number[] {
  if (!reference) {
    return []
  }
  const pages = new Set<number>()
  const pattern = /\b(?:pp?\.|pages?)\s*(\d+)(?:\s*[-\u2013\u2014]\s*(\d+))?/gi
  for (const match of reference.matchAll(pattern)) {
    const start = Number(match[1])
    if (!Number.isSafeInteger(start) || start <= 0) {
      continue
    }
    const end = match[2] ? Number(match[2]) : start
    if (Number.isSafeInteger(end) && end > start && end - start <= 20) {
      for (let page = start; page <= end; page += 1) {
        pages.add(page)
      }
    } else {
      pages.add(start)
      if (Number.isSafeInteger(end) && end > start) {
        pages.add(end)
      }
    }
  }
  return [...pages].sort((a, b) => a - b).slice(0, 20)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export interface PaperContext {
  page: number
  offset: number
  before: string
  match: string
  after: string
  snippet: string
}

function collectQuoteContexts(
  text: string,
  words: readonly string[],
  radius: number,
  maxContexts: number
): PaperContext[] {
  if (words.length === 0) {
    return []
  }
  const pattern = words.map(escapeRegExp).join("\\s+")
  let expression: RegExp
  try {
    expression = new RegExp(pattern, "gi")
  } catch {
    return []
  }
  const contexts: PaperContext[] = []
  for (const match of text.matchAll(expression)) {
    const index = match.index
    if (index === undefined) {
      continue
    }
    const before = text.slice(Math.max(0, index - radius), index)
    const after = text.slice(
      index + match[0].length,
      Math.min(text.length, index + match[0].length + radius)
    )
    const page = text.slice(0, index).split("\f").length
    contexts.push({
      page,
      offset: index,
      before,
      match: match[0],
      after,
      snippet: `${before}${match[0]}${after}`.trim(),
    })
    if (contexts.length >= maxContexts) {
      break
    }
  }
  return contexts
}

export function findQuoteContexts(
  text: string,
  quote: string | null | undefined,
  options: { radius?: number; maxContexts?: number } = {}
): PaperContext[] {
  if (!quote || quote.trim() === "") {
    return []
  }
  const radius = options.radius ?? PAPER_CONTEXT_RADIUS
  const maxContexts = options.maxContexts ?? MAX_PAPER_CONTEXTS
  const normalized = quote.replace(/\s+/g, " ").trim().slice(0, 180)
  const words = normalized.split(" ").filter(Boolean).slice(0, 24)
  const exact = collectQuoteContexts(text, words, radius, maxContexts)
  if (exact.length > 0) {
    return exact
  }
  return collectQuoteContexts(text, words.slice(0, 8), radius, maxContexts)
}

export interface PaperSearchMatch {
  line: number
  page: number
  offset: number
  excerpt: string
}

export function searchPaperText(
  text: string,
  query: string,
  maxResults: number = MAX_PAPER_SEARCH_RESULTS
): { results: PaperSearchMatch[]; truncated: boolean } {
  const needle = query.trim().toLowerCase()
  if (needle === "") {
    return { results: [], truncated: false }
  }
  const haystack = text.toLowerCase()
  const results: PaperSearchMatch[] = []
  let offset = haystack.indexOf(needle)
  let truncated = false
  while (offset >= 0) {
    if (results.length >= maxResults) {
      truncated = true
      break
    }
    const line = text.slice(0, offset).split("\n").length
    const page = text.slice(0, offset).split("\f").length
    results.push({
      line,
      page,
      offset,
      excerpt: text
        .slice(
          Math.max(0, offset - PAPER_CONTEXT_RADIUS),
          offset + needle.length + PAPER_CONTEXT_RADIUS
        )
        .trim(),
    })
    offset = haystack.indexOf(needle, offset + needle.length)
  }
  return { results, truncated }
}

export interface PaperEvidence {
  paperRef: string | null
  pages: number[]
  pdfAvailable: boolean
  pdfUrl: string | null
  paperTextAvailable: boolean
  paperTextUrl: string | null
  paperTextTruncated: boolean
  quote: string | null
  contexts: PaperContext[]
}

async function buildPaperEvidence(
  finding: ReviewFinding,
  roots: EvidenceRoots,
  batchId: string,
  paperId: string
): Promise<PaperEvidence> {
  const pdfRelative = roots.pdfPath
    ? toPaperRelative(roots.paperDir, roots.pdfPath)
    : null
  const textRelative = roots.paperTextPath
    ? toPaperRelative(roots.paperDir, roots.paperTextPath)
    : null
  const pdfFile = pdfRelative
    ? await resolvePaperFilePath(roots.paperDir, roots.batchRoot, pdfRelative)
    : null
  const textFile = textRelative
    ? await resolvePaperFilePath(roots.paperDir, roots.batchRoot, textRelative)
    : null
  const textRead = textFile
    ? await readCapped(textFile.realPath, 8 * 1024 * 1024)
    : null
  return {
    paperRef: finding.paperRef,
    pages: parsePaperPages(finding.paperRef),
    pdfAvailable: pdfFile !== null,
    pdfUrl:
      pdfFile !== null && pdfRelative !== null
        ? evidenceFileUrl(batchId, paperId, pdfRelative)
        : null,
    paperTextAvailable: textRead !== null && !textRead.binary,
    paperTextUrl:
      textFile !== null && textRelative !== null
        ? evidenceFileUrl(batchId, paperId, textRelative)
        : null,
    paperTextTruncated: textRead?.truncated ?? false,
    quote: finding.quote,
    contexts:
      textRead !== null && !textRead.binary
        ? findQuoteContexts(textRead.text, finding.quote)
        : [],
  }
}

export interface ReportExcerpt {
  startLine: number
  endLine: number
  totalLines: number
  excerpt: string
  truncated: boolean
}

export function excerptAroundLine(
  text: string,
  centerLine: number | null,
  radius: number = REPORT_CONTEXT_LINES
): ReportExcerpt {
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop()
  }
  const totalLines = lines.length
  if (totalLines === 0) {
    return {
      startLine: 1,
      endLine: 0,
      totalLines: 0,
      excerpt: "",
      truncated: false,
    }
  }
  const center =
    centerLine !== null && centerLine > 0 ? Math.min(centerLine, totalLines) : 1
  const startLine = Math.max(1, center - radius)
  const endLine = Math.min(totalLines, center + radius)
  return {
    startLine,
    endLine,
    totalLines,
    excerpt: lines.slice(startLine - 1, endLine).join("\n"),
    truncated: startLine > 1 || endLine < totalLines,
  }
}

export interface ReportEvidence {
  side: EvidenceSide
  label: string
  relativePath: string | null
  url: string | null
  available: boolean
  note: string | null
  startLine: number
  endLine: number
  totalLines: number
  excerpt: string
  truncated: boolean
}

async function buildReportEvidence(
  finding: ReviewFinding,
  side: EvidenceSide,
  roots: EvidenceRoots,
  batchId: string,
  paperId: string
): Promise<ReportEvidence> {
  const absolute =
    side === "agent" ? roots.agentReportPath : roots.auditowlReportPath
  const label = side === "agent" ? "run/audit.md" : "auditowl/audit.md"
  const empty: ReportEvidence = {
    side,
    label,
    relativePath: null,
    url: null,
    available: false,
    note: "the audit report is not part of this batch",
    startLine: 1,
    endLine: 0,
    totalLines: 0,
    excerpt: "",
    truncated: false,
  }
  if (!absolute) {
    return empty
  }
  const relative = toPaperRelative(roots.paperDir, absolute)
  if (relative === null) {
    return empty
  }
  const resolved = await resolvePaperFilePath(
    roots.paperDir,
    roots.batchRoot,
    relative
  )
  if (!resolved) {
    return { ...empty, relativePath: relative }
  }
  const read = await readCapped(resolved.realPath, 4 * 1024 * 1024)
  if (read === null || read.binary) {
    return { ...empty, relativePath: relative }
  }
  const excerpt = excerptAroundLine(read.text, finding.auditMdLine)
  return {
    side,
    label,
    relativePath: relative,
    url: evidenceFileUrl(batchId, paperId, relative),
    available: true,
    note: read.truncated
      ? "the report is larger than 4 MB; only an excerpt is shown"
      : excerpt.truncated && finding.auditMdLine === null
        ? "no audit_md_line is recorded; showing the beginning of the report"
        : null,
    startLine: excerpt.startLine,
    endLine: excerpt.endLine,
    totalLines: excerpt.totalLines,
    excerpt: excerpt.excerpt,
    truncated: excerpt.truncated || read.truncated,
  }
}

export interface FindingEvidence {
  id: string
  idLocal: string
  side: EvidenceSide
  title: string
  severity: Severity
  file: string
  code: CodeEvidence
  checks: CheckEvidence[]
  paper: PaperEvidence
  report: ReportEvidence
}

export interface EvidenceSideBundle {
  side: EvidenceSide
  findings: FindingEvidence[]
  totalFindings: number
  truncated: boolean
}

export interface EvidenceHealth {
  codeTotal: number
  codeResolved: number
  codeMissing: number
  quoteExact: number
  quoteFuzzy: number
  quoteMissing: number
  checksTotal: number
  checksResolved: number
  paperRefs: number
  reportsTotal: number
  reportsAvailable: number
}

export interface EvidenceBundle {
  batchId: string
  paperId: string
  itemKind: ItemKind
  itemRef: string
  itemTitle: string
  severity: Severity
  sides: EvidenceSideBundle[]
  health: EvidenceHealth
}

async function buildFindingEvidence(
  finding: ReviewFinding,
  side: EvidenceSide,
  roots: EvidenceRoots,
  batchId: string,
  paperId: string
): Promise<FindingEvidence> {
  const [code, checks, paper, report] = await Promise.all([
    buildCodeEvidence(finding, side, roots, batchId, paperId),
    Promise.all(
      checkReferences(finding).map((reference) =>
        buildCheckEvidence(reference, finding, side, roots, batchId, paperId)
      )
    ),
    buildPaperEvidence(finding, roots, batchId, paperId),
    buildReportEvidence(finding, side, roots, batchId, paperId),
  ])
  return {
    id: finding.id,
    idLocal: finding.idLocal,
    side,
    title: finding.title,
    severity: finding.severity,
    file: finding.file,
    code,
    checks,
    paper,
    report,
  }
}

export function sidesForItem(kind: ItemKind): EvidenceSide[] {
  if (kind === "agent_only") {
    return ["agent"]
  }
  if (kind === "auditowl_only") {
    return ["auditowl"]
  }
  return ["auditowl", "agent"]
}

function emptyHealth(): EvidenceHealth {
  return {
    codeTotal: 0,
    codeResolved: 0,
    codeMissing: 0,
    quoteExact: 0,
    quoteFuzzy: 0,
    quoteMissing: 0,
    checksTotal: 0,
    checksResolved: 0,
    paperRefs: 0,
    reportsTotal: 0,
    reportsAvailable: 0,
  }
}

export interface BuildEvidenceInput {
  batchId: string
  paperId: string
  item: ReviewItem
  roots: EvidenceRoots
}

export async function buildEvidenceBundle(
  input: BuildEvidenceInput
): Promise<EvidenceBundle> {
  const { batchId, paperId, item, roots } = input
  const health = emptyHealth()
  const sides: EvidenceSideBundle[] = []

  for (const side of sidesForItem(item.kind)) {
    const findings = item.findings[side]
    const selected = findings.slice(0, MAX_FINDINGS_PER_SIDE)
    const evidence = await Promise.all(
      selected.map((finding) =>
        buildFindingEvidence(finding, side, roots, batchId, paperId)
      )
    )
    for (const finding of evidence) {
      const codeKnown = finding.code.kind !== "url"
      if (codeKnown) {
        health.codeTotal += 1
        if (finding.code.kind === "missing") {
          health.codeMissing += 1
        } else {
          health.codeResolved += 1
        }
      }
      if (finding.code.quoteMatch === "exact") {
        health.quoteExact += 1
      } else if (finding.code.quoteMatch === "fuzzy") {
        health.quoteFuzzy += 1
      } else if (finding.code.quoteMatch === "missing") {
        health.quoteMissing += 1
      }
      health.checksTotal += finding.checks.length
      health.checksResolved += finding.checks.filter(
        (check) => check.resolved
      ).length
      if (finding.paper.paperRef) {
        health.paperRefs += 1
      }
      health.reportsTotal += 1
      if (finding.report.available) {
        health.reportsAvailable += 1
      }
    }
    sides.push({
      side,
      findings: evidence,
      totalFindings: findings.length,
      truncated: findings.length > selected.length,
    })
  }

  return {
    batchId,
    paperId,
    itemKind: item.kind,
    itemRef: item.ref,
    itemTitle: item.title,
    severity: item.severity,
    sides,
    health,
  }
}

export interface ResolvedPaperFile {
  absolutePath: string
  realPath: string
  relativePath: string
  size: number
}

/**
 * Resolve a paper-relative evidence path with lexical and realpath containment.
 * Returns null for missing files, directories, and any symlink escape.
 */
export async function resolvePaperFilePath(
  paperDir: string,
  batchRoot: string,
  relative: string
): Promise<ResolvedPaperFile | null> {
  if (hasTraversal(relative) || isIgnoredRelativePath(relative)) {
    return null
  }
  const lexical = joinWithin(paperDir, relative)
  if (lexical === null) {
    return null
  }
  let realPaper: string
  let realBatch: string
  let realTarget: string
  try {
    realPaper = await realpath(paperDir)
    realBatch = await realpath(batchRoot)
    realTarget = await realpath(lexical)
  } catch {
    return null
  }
  if (!isWithin(realPaper, realTarget) || !isWithin(realBatch, realTarget)) {
    return null
  }
  if (isIgnoredRelativePath(toPosix(path.relative(realPaper, realTarget)))) {
    return null
  }
  let info: Stats
  try {
    info = await stat(realTarget)
  } catch {
    return null
  }
  if (!info.isFile()) {
    return null
  }
  return {
    absolutePath: lexical,
    realPath: realTarget,
    relativePath: toPosix(path.relative(paperDir, lexical)),
    size: info.size,
  }
}

export interface TreeEntry {
  path: string
  name: string
  type: "file" | "directory"
  size: number
  binary: boolean
}

export interface TreeResult {
  entries: TreeEntry[]
  truncated: boolean
}

interface TreeRoot {
  absolute: string
  prefix: string
  includeRoot: boolean
}

async function walkTree(
  state: { entries: TreeEntry[]; truncated: boolean },
  absolute: string,
  prefix: string,
  skip: ReadonlySet<string> = new Set()
): Promise<void> {
  if (state.entries.length >= MAX_TREE_ENTRIES) {
    state.truncated = true
    return
  }
  let entries: Dirent[]
  try {
    entries = await readdir(absolute, { withFileTypes: true })
  } catch {
    return
  }
  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    if (state.entries.length >= MAX_TREE_ENTRIES) {
      state.truncated = true
      return
    }
    if (isIgnoredEntry(entry.name) || entry.isSymbolicLink()) {
      continue
    }
    if (prefix === "" && entry.isDirectory() && skip.has(entry.name)) {
      continue
    }
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      state.entries.push({
        path: relative,
        name: entry.name,
        type: "directory",
        size: 0,
        binary: false,
      })
      await walkTree(state, path.join(absolute, entry.name), relative, skip)
    } else if (entry.isFile()) {
      const info = await stat(path.join(absolute, entry.name)).catch(() => null)
      if (!info) {
        continue
      }
      state.entries.push({
        path: relative,
        name: entry.name,
        type: "file",
        size: info.size,
        binary: isBinaryPath(entry.name),
      })
    }
  }
}

export async function listTree(input: {
  paper: PaperLike
  scope: "code" | "paper" | "run" | "auditowl"
}): Promise<TreeResult> {
  const { paper, scope } = input
  let realPaper: string
  try {
    realPaper = await realpath(paper.dir)
  } catch {
    return { entries: [], truncated: false }
  }

  // Manifest paths are user-controlled data. Resolve them with realpath and
  // refuse any root that leaves the paper directory, so a symlinked `code/`
  // or `run/` entry cannot walk the rest of the batch or the host.
  const validatedRoot = async (candidate: string): Promise<string | null> => {
    try {
      const real = await realpath(candidate)
      if (!isWithin(realPaper, real)) {
        return null
      }
      if (isIgnoredRelativePath(toPosix(path.relative(realPaper, real)))) {
        return null
      }
      return real
    } catch {
      return null
    }
  }

  const roots: TreeRoot[] = []
  if (scope === "code") {
    for (const repo of paper.manifest.code) {
      if (isIgnoredRelativePath(repo.dir)) {
        continue
      }
      const absolute = joinWithin(paper.dir, repo.dir)
      const real = absolute ? await validatedRoot(absolute) : null
      if (real) {
        roots.push({
          absolute: real,
          prefix: toPosix(repo.dir),
          includeRoot: true,
        })
      }
    }
  } else if (scope === "paper") {
    roots.push({ absolute: realPaper, prefix: "", includeRoot: false })
  } else if (scope === "run") {
    const runRelative = paper.manifest.files.agentRun
    const absolute = isIgnoredRelativePath(runRelative)
      ? null
      : joinWithin(paper.dir, runRelative)
    const real = absolute ? await validatedRoot(absolute) : null
    if (real) {
      roots.push({
        absolute: real,
        prefix: toPosix(runRelative),
        includeRoot: false,
      })
    }
  } else {
    const auditowlRelative = paper.manifest.files.auditowlDir
    const absolute = isIgnoredRelativePath(auditowlRelative)
      ? null
      : joinWithin(paper.dir, auditowlRelative)
    const real = absolute ? await validatedRoot(absolute) : null
    if (real) {
      roots.push({
        absolute: real,
        prefix: toPosix(auditowlRelative),
        includeRoot: false,
      })
    }
  }

  const state: { entries: TreeEntry[]; truncated: boolean } = {
    entries: [],
    truncated: false,
  }
  const skip =
    scope === "paper" ? new Set(["code", "run", "auditowl"]) : new Set<string>()
  for (const root of roots) {
    if (root.includeRoot) {
      state.entries.push({
        path: root.prefix,
        name: path.posix.basename(root.prefix),
        type: "directory",
        size: 0,
        binary: false,
      })
    }
    await walkTree(state, root.absolute, root.prefix, skip)
  }
  return { entries: state.entries, truncated: state.truncated }
}

export interface SearchResult {
  path: string | null
  url: string | null
  line: number
  excerpt: string
  repo: string | null
  page: number | null
}

export interface SearchOutcome {
  results: SearchResult[]
  truncated: boolean
  unavailable: boolean
}

const rgMessageSchema = z.object({
  type: z.string(),
  data: z
    .object({
      path: z.object({ text: z.string() }).optional(),
      line_number: z.number().int().positive().optional(),
      lines: z.object({ text: z.string() }).optional(),
    })
    .optional(),
})

export interface RgRun {
  lines: string[]
  unavailable: boolean
  timedOut: boolean
  outputCapped: boolean
}

export interface RgOptions {
  timeoutMs?: number
  maxOutputBytes?: number
}

export function runRipgrep(
  directory: string,
  query: string,
  options: RgOptions = {}
): Promise<RgRun> {
  const timeoutMs = options.timeoutMs ?? RG_TIMEOUT_MS
  const maxOutputBytes = options.maxOutputBytes ?? 4 * 1024 * 1024
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      // Keep the executable literal: a dynamic command makes Next's tracer
      // treat the whole project directory as runtime input for the standalone
      // build. Tests simulate a missing ripgrep by emptying PATH.
      child = spawn(
        "rg",
        [
          "--json",
          "--no-messages",
          "--fixed-strings",
          "--max-filesize",
          "2M",
          ...RG_EXCLUDES.flatMap((glob) => ["--glob", glob]),
          "--",
          query,
          ".",
        ],
        { cwd: directory, stdio: ["ignore", "pipe", "ignore"] }
      )
    } catch {
      resolve({
        lines: [],
        unavailable: true,
        timedOut: false,
        outputCapped: false,
      })
      return
    }

    let buffer = ""
    let settled = false
    let timedOut = false
    let outputCapped = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, timeoutMs)
    const finish = (run: RgRun): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      resolve(run)
    }

    child.on("error", (error: NodeJS.ErrnoException) => {
      finish({
        lines: [],
        unavailable: error.code === "ENOENT",
        timedOut,
        outputCapped,
      })
    })
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8")
      if (buffer.length > maxOutputBytes && !outputCapped) {
        outputCapped = true
        child.stdout?.destroy()
        child.kill("SIGKILL")
      }
    })
    child.on("close", () => {
      finish({
        lines: buffer.split("\n").filter((line) => line.trim() !== ""),
        unavailable: false,
        timedOut,
        outputCapped,
      })
    })
  })
}

export async function searchCode(
  paper: PaperLike,
  batchId: string,
  query: string,
  options: RgOptions = {}
): Promise<SearchOutcome> {
  const realPaper = await realpath(paper.dir).catch(() => null)
  if (realPaper === null) {
    return { results: [], truncated: false, unavailable: false }
  }
  const results: SearchResult[] = []
  let truncated = false
  for (const repo of paper.manifest.code) {
    if (isIgnoredRelativePath(repo.dir)) {
      continue
    }
    const directory = joinWithin(paper.dir, repo.dir)
    if (!directory) {
      continue
    }
    const realDirectory = await realpath(directory).catch(() => null)
    if (realDirectory === null || !isWithin(realPaper, realDirectory)) {
      continue
    }
    if (
      isIgnoredRelativePath(toPosix(path.relative(realPaper, realDirectory)))
    ) {
      continue
    }
    const run = await runRipgrep(directory, query, options)
    if (run.unavailable) {
      return { results: [], truncated: false, unavailable: true }
    }
    let count = 0
    for (const line of run.lines) {
      let parsed: unknown
      try {
        parsed = JSON.parse(line) as unknown
      } catch {
        continue
      }
      const message = rgMessageSchema.safeParse(parsed)
      if (!message.success || message.data.type !== "match") {
        continue
      }
      const data = message.data.data
      if (!data?.path || !data.line_number || !data.lines) {
        continue
      }
      if (count >= MAX_SEARCH_RESULTS_PER_REPO) {
        truncated = true
        break
      }
      const insideRepo = data.path.text.replace(/^\.\//, "")
      if (isIgnoredRelativePath(insideRepo)) {
        continue
      }
      const absolute = path.resolve(directory, insideRepo)
      if (!isWithin(directory, absolute)) {
        continue
      }
      const realTarget = await realpath(absolute).catch(() => null)
      if (realTarget === null || !isWithin(realPaper, realTarget)) {
        continue
      }
      if (
        isIgnoredRelativePath(toPosix(path.relative(realPaper, realTarget)))
      ) {
        continue
      }
      const relative = `${toPosix(repo.dir)}/${insideRepo}`
      results.push({
        path: relative,
        url: evidenceFileUrl(batchId, paper.manifest.id, relative),
        line: data.line_number,
        excerpt: data.lines.text.trimEnd(),
        repo: repo.name,
        page: null,
      })
      count += 1
    }
    if (run.timedOut || run.outputCapped) {
      truncated = true
    }
  }
  return { results, truncated, unavailable: false }
}

export async function searchPaper(
  paper: PaperLike,
  batchId: string,
  query: string
): Promise<SearchOutcome> {
  const relativeText = toPosix(paper.manifest.files.paperText)
  if (isIgnoredRelativePath(relativeText)) {
    return { results: [], truncated: false, unavailable: false }
  }
  const paperTextPath = joinWithin(paper.dir, paper.manifest.files.paperText)
  if (!paperTextPath) {
    return { results: [], truncated: false, unavailable: false }
  }
  const realPaper = await realpath(paper.dir).catch(() => null)
  const realText = await realpath(paperTextPath).catch(() => null)
  if (
    realPaper === null ||
    realText === null ||
    !isWithin(realPaper, realText) ||
    isIgnoredRelativePath(toPosix(path.relative(realPaper, realText)))
  ) {
    return { results: [], truncated: false, unavailable: false }
  }
  const read = await readCapped(realText, 8 * 1024 * 1024)
  if (read === null || read.binary) {
    return { results: [], truncated: false, unavailable: false }
  }
  const matches = searchPaperText(read.text, query)
  return {
    results: matches.results.map((match) => ({
      path: relativeText,
      url: evidenceFileUrl(batchId, paper.manifest.id, relativeText),
      line: match.line,
      excerpt: match.excerpt,
      repo: null,
      page: match.page,
    })),
    truncated: matches.truncated || read.truncated,
    unavailable: false,
  }
}
