import {
  open,
  readdir,
  realpath,
  stat,
  type FileHandle,
} from "node:fs/promises"
import path from "node:path"
import type { Dirent, Stats } from "node:fs"

import {
  hasTraversal,
  isIgnoredRelativePath,
  isWithin,
  joinWithin,
} from "@/lib/review/paths"
import type { EvidenceSide } from "@/lib/review/types"

export type EvidenceKind = "file" | "check" | "paper" | "url" | "missing"
export type QuoteMatch = "exact" | "fuzzy" | "missing" | "not_checkable"

export interface RepoRoot {
  name: string
  dir: string
}

export interface ResolveRoots {
  batchRoot: string
  paperDir: string
  repos: readonly RepoRoot[]
  runDir?: string | null
  auditowlDir?: string | null
}

export interface ResolveFinding {
  file: string
  quote?: string | null
  lineStart?: number | null
  lineEnd?: number | null
}

export interface ResolveEvidenceInput {
  roots: ResolveRoots
  side: EvidenceSide
  finding: ResolveFinding
}

export interface ResolutionAttempt {
  step: string
  path: string
  outcome: "hit" | "miss" | "skip"
  note?: string
}

export interface ResolvedEvidence {
  kind: EvidenceKind
  absolutePath: string | null
  url: string | null
  lineStart: number | null
  lineEnd: number | null
  attempts: ResolutionAttempt[]
  quoteMatch: QuoteMatch
  note: string | null
}

interface ResolveContext {
  roots: ResolveRoots
  attempts: ResolutionAttempt[]
  realRoot: string
  realPaper: string
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/")
}

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

const joinInside = joinWithin

function lineRange(finding: ResolveFinding): {
  lineStart: number | null
  lineEnd: number | null
} {
  const start =
    typeof finding.lineStart === "number" && finding.lineStart > 0
      ? Math.trunc(finding.lineStart)
      : null
  if (start === null) {
    return { lineStart: null, lineEnd: null }
  }
  const end =
    typeof finding.lineEnd === "number" && finding.lineEnd >= start
      ? Math.trunc(finding.lineEnd)
      : start
  return { lineStart: start, lineEnd: end }
}

const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".venv",
])

async function tryFile(
  context: ResolveContext,
  absolute: string | null,
  step: string
): Promise<string | null> {
  if (absolute === null) {
    context.attempts.push({
      step,
      path: "",
      outcome: "skip",
      note: "escapes the batch root",
    })
    return null
  }
  if (!isWithin(context.roots.batchRoot, absolute)) {
    context.attempts.push({
      step,
      path: absolute,
      outcome: "skip",
      note: "escapes the batch root",
    })
    return null
  }
  if (!isWithin(context.roots.paperDir, absolute)) {
    context.attempts.push({
      step,
      path: absolute,
      outcome: "skip",
      note: "escapes the paper directory",
    })
    return null
  }
  if (
    isIgnoredRelativePath(
      toPosix(path.relative(context.roots.paperDir, absolute))
    )
  ) {
    context.attempts.push({
      step,
      path: absolute,
      outcome: "skip",
      note: "ignored evidence path",
    })
    return null
  }
  let info: Stats
  try {
    info = await stat(absolute)
  } catch {
    context.attempts.push({ step, path: absolute, outcome: "miss" })
    return null
  }
  if (!info.isFile()) {
    context.attempts.push({
      step,
      path: absolute,
      outcome: "miss",
      note: "not a regular file",
    })
    return null
  }
  try {
    const real = await realpath(absolute)
    if (
      !isWithin(context.realRoot, real) ||
      !isWithin(context.realPaper, real)
    ) {
      context.attempts.push({
        step,
        path: absolute,
        outcome: "skip",
        note: "resolves outside the paper directory",
      })
      return null
    }
    if (
      isIgnoredRelativePath(toPosix(path.relative(context.realPaper, real)))
    ) {
      context.attempts.push({
        step,
        path: absolute,
        outcome: "skip",
        note: "resolves to an ignored evidence path",
      })
      return null
    }
  } catch {
    context.attempts.push({ step, path: absolute, outcome: "miss" })
    return null
  }
  context.attempts.push({ step, path: absolute, outcome: "hit" })
  return absolute
}

async function tryJoin(
  context: ResolveContext,
  root: string | null | undefined,
  relative: string,
  step: string
): Promise<string | null> {
  if (!root) {
    return null
  }
  return tryFile(context, joinInside(root, relative), step)
}

async function tryRepoPrefixed(
  context: ResolveContext,
  relative: string,
  step: string
): Promise<string | null> {
  const direct = await tryJoin(
    context,
    context.roots.paperDir,
    relative,
    `${step}:paper`
  )
  if (direct) {
    return direct
  }
  for (const repo of context.roots.repos) {
    if (relative === repo.name || relative.startsWith(`${repo.name}/`)) {
      const rest = relative.slice(repo.name.length).replace(/^\/+/, "")
      const hit = await tryJoin(context, repo.dir, rest, `${step}:${repo.name}`)
      if (hit) {
        return hit
      }
    }
  }
  return null
}

const ARM_SEGMENT = /^(?:audit\d*|verify\d*|escalate\d*)$/

interface ArmPath {
  /** Explicit arm directory such as `audit` or `audit2`; null means any arm. */
  arm: string | null
  /** Path below `<arm>/work/`, or the original arm-relative path. */
  rest: string
}

function parseArmPath(relative: string): ArmPath | null {
  const segments = relative.split("/")
  if (
    segments.length > 2 &&
    ARM_SEGMENT.test(segments[0]) &&
    segments[1] === "work"
  ) {
    return { arm: segments[0], rest: segments.slice(2).join("/") }
  }
  if (
    relative.startsWith("out/") ||
    relative.startsWith("_audit_code/") ||
    relative.startsWith("_verifier_code")
  ) {
    return { arm: null, rest: relative }
  }
  return null
}

function normalizeRoots(roots: ResolveRoots): ResolveRoots {
  return {
    batchRoot: path.resolve(roots.batchRoot),
    paperDir: path.resolve(roots.paperDir),
    repos: roots.repos.map((repo) => ({
      name: repo.name,
      dir: path.resolve(repo.dir),
    })),
    runDir: roots.runDir ? path.resolve(roots.runDir) : null,
    auditowlDir: roots.auditowlDir ? path.resolve(roots.auditowlDir) : null,
  }
}

async function listDirectories(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(directory, entry.name))
      .sort()
  } catch {
    return []
  }
}

function runArmCandidates(workDir: string, rest: string): string[] {
  if (rest.startsWith("_audit_code/") || rest.startsWith("_verifier_code")) {
    return [path.join(workDir, rest)]
  }
  return [path.join(workDir, "_audit_code", rest), path.join(workDir, rest)]
}

async function verifierCandidates(
  workDir: string,
  rest: string
): Promise<string[]> {
  const candidates: string[] = []
  for (const verifierDir of await listDirectories(workDir)) {
    if (path.basename(verifierDir).startsWith("_verifier_code")) {
      candidates.push(path.join(verifierDir, rest))
    }
  }
  return candidates
}

async function searchRunArmTrees(
  context: ResolveContext,
  armPath: ArmPath
): Promise<string | null> {
  const runDir = context.roots.runDir
  if (!runDir) {
    return null
  }
  const arms = armPath.arm
    ? [path.join(runDir, armPath.arm)]
    : await listDirectories(runDir)
  for (const armDir of arms) {
    const workDir = path.join(armDir, "work")
    const candidates = runArmCandidates(workDir, armPath.rest)
    candidates.push(...(await verifierCandidates(workDir, armPath.rest)))
    for (const candidate of candidates) {
      const hit = await tryFile(context, candidate, "arm-tree:run")
      if (hit) {
        return hit
      }
    }
  }
  return null
}

async function searchAuditowlArmTrees(
  context: ResolveContext,
  armPath: ArmPath
): Promise<string | null> {
  const auditowlDir = context.roots.auditowlDir
  if (!auditowlDir) {
    return null
  }
  const { rest } = armPath
  const direct = await tryJoin(context, auditowlDir, rest, "arm-tree:auditowl")
  if (direct) {
    return direct
  }
  if (armPath.arm) {
    const armDirect = await tryJoin(
      context,
      path.join(auditowlDir, armPath.arm),
      rest,
      "arm-tree:auditowl-arm"
    )
    if (armDirect) {
      return armDirect
    }
  }
  for (const subDir of await listDirectories(auditowlDir)) {
    const base = path.basename(subDir)
    if (base.startsWith("_audit_code") || base.startsWith("_verifier_code")) {
      const hit = await tryJoin(
        context,
        subDir,
        rest,
        "arm-tree:auditowl-subdir"
      )
      if (hit) {
        return hit
      }
    }
  }
  return null
}

async function searchArmTrees(
  context: ResolveContext,
  armPath: ArmPath,
  side: EvidenceSide
): Promise<string | null> {
  const ordered =
    side === "auditowl"
      ? [searchAuditowlArmTrees, searchRunArmTrees]
      : [searchRunArmTrees, searchAuditowlArmTrees]
  for (const search of ordered) {
    const hit = await search(context, armPath)
    if (hit) {
      return hit
    }
  }
  return null
}

async function collectByBasename(
  directory: string,
  basename: string,
  matches: string[]
): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue
    }
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        await collectByBasename(absolute, basename, matches)
      }
    } else if (entry.isFile() && entry.name === basename) {
      matches.push(absolute)
    }
  }
}

async function searchUniqueBasename(
  context: ResolveContext,
  relative: string
): Promise<string | null> {
  const basename = path.posix.basename(relative)
  const matches: string[] = []
  for (const repo of context.roots.repos) {
    await collectByBasename(repo.dir, basename, matches)
  }
  if (matches.length === 1) {
    return tryFile(context, matches[0], "unique-basename")
  }
  context.attempts.push({
    step: "unique-basename",
    path: basename,
    outcome: "miss",
    note:
      matches.length === 0
        ? "no file with this basename in the repo trees"
        : `${matches.length} files with this basename; not unique`,
  })
  return null
}

function classifyKind(relative: string): EvidenceKind {
  const basename = path.posix.basename(relative)
  if (
    basename === "paper.pdf" ||
    basename === "paper_text.txt" ||
    basename === "paper.json"
  ) {
    return "paper"
  }
  if (
    relative.startsWith("out/") ||
    relative.startsWith("_audit_code/") ||
    relative.includes("/out/") ||
    relative.includes("/_audit_code/") ||
    relative.includes("_verifier_code")
  ) {
    return "check"
  }
  return "file"
}

export function normalizeQuote(text: string): string {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
  let start = 0
  let end = lines.length
  while (start < end && lines[start].trim() === "") {
    start += 1
  }
  while (end > start && lines[end - 1].trim() === "") {
    end -= 1
  }
  const body = lines.slice(start, end)
  const indents = body
    .filter((line) => line.trim() !== "")
    .map((line) => /^[ \t]*/.exec(line)?.[0].length ?? 0)
  const common = indents.length > 0 ? Math.min(...indents) : 0
  return body.map((line) => line.slice(common)).join("\n")
}

export function normalizeForMatch(text: string): string {
  return normalizeQuote(text).replace(/\s+/g, " ").trim()
}

function stripElisionLines(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:\.{3}|…)\s*$/.test(line))
    .join("\n")
}

function tokens(text: string): Set<string> {
  const normalized = text.toLowerCase()
  const result = new Set<string>()
  for (const token of normalized.split(/[^a-z0-9_]+/)) {
    if (token) {
      result.add(token)
    }
  }
  return result
}

export function compareQuote(quote: string, cited: string): QuoteMatch {
  const left = normalizeForMatch(stripElisionLines(quote))
  const right = normalizeForMatch(stripElisionLines(cited))
  if (left === "" || right === "") {
    return "missing"
  }
  if (left === right) {
    return "exact"
  }
  const leftTokens = tokens(left)
  const rightTokens = tokens(right)
  if (leftTokens.size >= 3) {
    let shared = 0
    for (const token of leftTokens) {
      if (rightTokens.has(token)) {
        shared += 1
      }
    }
    if (shared / leftTokens.size >= 0.8) {
      return "fuzzy"
    }
  }
  if (left.includes(right) || right.includes(left)) {
    return "fuzzy"
  }
  return "missing"
}

export const MAX_QUOTE_READ_BYTES = 1024 * 1024

export interface QuoteVerification {
  match: QuoteMatch
  note: string | null
}

interface BoundedRead {
  buffer: Buffer
  size: number
}

async function readHeadBounded(
  absolutePath: string,
  maxBytes: number
): Promise<BoundedRead | null> {
  let handle: FileHandle
  try {
    handle = await open(absolutePath, "r")
  } catch {
    return null
  }
  try {
    const info = await handle.stat()
    const length = Math.min(info.size, maxBytes)
    const buffer = Buffer.alloc(length)
    if (length > 0) {
      await handle.read(buffer, 0, length, 0)
    }
    return { buffer, size: info.size }
  } catch {
    return null
  } finally {
    await handle.close().catch(() => undefined)
  }
}

/**
 * Verify a quote against the cited lines. Only the first `MAX_QUOTE_READ_BYTES`
 * are read; a citation past those bytes is `not_checkable`, never a mismatch.
 * There is deliberately no line-number pre-check: a 10 KB file cited at line
 * 405 is checked normally.
 */
export async function verifyQuoteAtPath(
  absolutePath: string,
  quote: string | null | undefined,
  lineStart: number | null,
  lineEnd: number | null
): Promise<QuoteVerification> {
  if (!quote || quote.trim() === "" || lineStart === null) {
    return { match: "not_checkable", note: null }
  }
  const read = await readHeadBounded(absolutePath, MAX_QUOTE_READ_BYTES)
  if (read === null) {
    return { match: "missing", note: null }
  }
  if (read.buffer.includes(0)) {
    return { match: "not_checkable", note: "the file looks binary" }
  }
  const truncated = read.size > MAX_QUOTE_READ_BYTES
  const lines = read.buffer.toString("utf8").split(/\r\n?|\n/)
  // The final line of a truncated read may be incomplete; drop it so it is
  // never compared as if it were complete.
  if (truncated && lines.length > 0) {
    lines.pop()
  }
  if (lineStart > lines.length) {
    return truncated
      ? {
          match: "not_checkable",
          note: `the cited line is beyond the first ${MAX_QUOTE_READ_BYTES} bytes that were read`,
        }
      : { match: "missing", note: null }
  }
  const end = lineEnd !== null && lineEnd >= lineStart ? lineEnd : lineStart
  if (truncated && end > lines.length) {
    return {
      match: "not_checkable",
      note: `the cited line range extends beyond the first ${MAX_QUOTE_READ_BYTES} bytes that were read`,
    }
  }
  const cited = lines
    .slice(lineStart - 1, Math.min(end, lines.length))
    .join("\n")
  return { match: compareQuote(quote, cited), note: null }
}

function resultFor(
  kind: EvidenceKind,
  absolutePath: string | null,
  url: string | null,
  finding: ResolveFinding,
  attempts: ResolutionAttempt[],
  quoteMatch: QuoteMatch,
  note: string | null
): ResolvedEvidence {
  const { lineStart, lineEnd } = lineRange(finding)
  return {
    kind,
    absolutePath,
    url,
    lineStart,
    lineEnd,
    attempts,
    quoteMatch,
    note,
  }
}

export async function resolveEvidence(
  input: ResolveEvidenceInput
): Promise<ResolvedEvidence> {
  const { side, finding } = input
  const roots = normalizeRoots(input.roots)
  const raw = finding.file.trim()
  const attempts: ResolutionAttempt[] = []
  const { lineStart, lineEnd } = lineRange(finding)

  if (raw === "") {
    return resultFor(
      "missing",
      null,
      null,
      finding,
      attempts,
      finding.quote ? "missing" : "not_checkable",
      "finding has no file"
    )
  }

  if (isUrl(raw)) {
    return resultFor("url", null, raw, finding, attempts, "not_checkable", null)
  }

  if (
    path.isAbsolute(raw) ||
    /^[A-Za-z]:\//.test(raw.replace(/\\/g, "/")) ||
    hasTraversal(raw)
  ) {
    attempts.push({
      step: "reject-path",
      path: raw,
      outcome: "skip",
      note: "absolute paths and traversal are rejected",
    })
    return resultFor(
      "missing",
      null,
      null,
      finding,
      attempts,
      finding.quote ? "missing" : "not_checkable",
      "evidence path is absolute or escapes the batch"
    )
  }

  const relative = raw.replace(/\\/g, "/").replace(/^\.\/+/, "")
  let realRoot = path.resolve(roots.batchRoot)
  try {
    realRoot = await realpath(roots.batchRoot)
  } catch {
    // The batch root may not exist in a unit-test fixture; lexical containment
    // still applies in that case.
  }
  let realPaper = path.resolve(roots.paperDir)
  try {
    realPaper = await realpath(roots.paperDir)
  } catch {
    // Keep the lexical paper path for fixtures that do not exist on disk.
  }

  // Manifest roots are data, not trusted paths. Drop any repo, run or AuditOwl
  // root whose real target leaves the paper directory before it is walked.
  const usableRoot = async (
    candidate: string | null | undefined
  ): Promise<string | null> => {
    if (!candidate) {
      return null
    }
    try {
      const real = await realpath(candidate)
      if (!isWithin(realPaper, real)) {
        return null
      }
      if (isIgnoredRelativePath(toPosix(path.relative(realPaper, real)))) {
        return null
      }
      return candidate
    } catch {
      return null
    }
  }

  const repos: RepoRoot[] = []
  for (const repo of roots.repos) {
    if (isIgnoredRelativePath(toPosix(repo.dir))) {
      continue
    }
    const usable = await usableRoot(repo.dir)
    if (usable) {
      repos.push({ ...repo, dir: usable })
    }
  }
  const usableRunDir = await usableRoot(roots.runDir)
  const usableAuditowlDir = await usableRoot(roots.auditowlDir)
  const effectiveRoots: ResolveRoots = {
    ...roots,
    repos,
    runDir: usableRunDir,
    auditowlDir: usableAuditowlDir,
  }
  const context: ResolveContext = {
    roots: effectiveRoots,
    attempts,
    realRoot,
    realPaper,
  }

  const finish = async (
    absolutePath: string,
    stepRelative: string
  ): Promise<ResolvedEvidence> => {
    const kind = classifyKind(stepRelative)
    const verification =
      kind === "file" || kind === "check"
        ? await verifyQuoteAtPath(
            absolutePath,
            finding.quote,
            lineStart,
            lineEnd
          )
        : { match: "not_checkable" as const, note: null }
    return resultFor(
      kind,
      absolutePath,
      null,
      finding,
      attempts,
      verification.match,
      verification.note
    )
  }

  const paperHit = await tryJoin(
    context,
    effectiveRoots.paperDir,
    relative,
    "paper-dir"
  )
  if (paperHit) {
    return finish(paperHit, relative)
  }

  for (const repo of effectiveRoots.repos) {
    const hit = await tryJoin(context, repo.dir, relative, `repo:${repo.name}`)
    if (hit) {
      return finish(hit, relative)
    }
  }

  if (relative.startsWith("code/")) {
    const rest = relative.slice("code/".length)
    const stripped = await tryRepoPrefixed(context, rest, "strip-code")
    if (stripped) {
      return finish(stripped, rest)
    }
  }

  const repoPrefixed = await tryRepoPrefixed(context, relative, "strip-repo")
  if (repoPrefixed) {
    return finish(repoPrefixed, relative)
  }

  if (side === "agent") {
    const runHit = await tryJoin(
      context,
      effectiveRoots.runDir,
      relative,
      "side-root:run"
    )
    if (runHit) {
      return finish(runHit, relative)
    }
  } else {
    const auditowlHit = await tryJoin(
      context,
      effectiveRoots.auditowlDir,
      relative,
      "side-root:auditowl"
    )
    if (auditowlHit) {
      return finish(auditowlHit, relative)
    }
  }

  const armPath = parseArmPath(relative)
  if (armPath) {
    const armHit = await searchArmTrees(context, armPath, side)
    if (armHit) {
      return finish(armHit, relative)
    }
  }

  const basenameHit = await searchUniqueBasename(context, relative)
  if (basenameHit) {
    return finish(basenameHit, relative)
  }

  attempts.push({
    step: "unresolved",
    path: relative,
    outcome: "miss",
    note: "no candidate path matched",
  })

  return resultFor(
    "missing",
    null,
    null,
    finding,
    attempts,
    finding.quote ? "missing" : "not_checkable",
    "evidence path could not be resolved inside the batch"
  )
}
