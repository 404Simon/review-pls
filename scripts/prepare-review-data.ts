import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import {
  copyFile,
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import path from "node:path"

import { buildReviewData } from "@/lib/review/build"
import { batchContentFingerprint, sha256Bytes } from "@/lib/review/hash"
import {
  batchSchema,
  findingsFileSchema,
  overlapSchema,
  paperMetadataSchema,
  type Batch,
  type CodeRepoRole,
  type ExcludedPaper,
  type Finding,
  type Overlap,
  type PaperInput,
  type PaperManifest,
} from "@/lib/review/types"

type CopyMode = "copy" | "hardlink"

interface Options {
  source: string
  auditowl: string
  inputs: string | null
  batchId: string
  out: string
  exclude: string[]
  mode: CopyMode
  generatedAt: string | null
  force: boolean
}

interface CopyStats {
  bytes: number
  files: number
  skipped: number
}

interface CopyOptions {
  skip?: (relative: string, isDirectory: boolean) => boolean
}

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".venv",
])

const EXCLUDED_SUFFIXES = [".pyc", ".DS_Store"]

const EXCLUDED_REASONS: Readonly<Record<string, string>> = {
  "2254": "no AuditOwl findings / no author code",
  "3680": "repository revision mismatch; AuditOwl clone unavailable",
}

const DEFAULT_INPUTS = "review-agent/runs/inputs/neurips-2025-r16"

const TRANSIENT_RUN_DIRECTORIES = new Set([
  "verify-input",
  "escalation-input",
  "escalate",
])

const KEPT_RUN_FILES = new Set([
  "run.json",
  "union.json",
  "findings.json",
  "findings_verified.json",
  "overlap.json",
  "repo_revisions.json",
  "review.log",
  "evidence_catalog.md",
  "evidence-pruned.txt",
])

function printUsage(): void {
  console.log(`Usage: pnpm review-data:prepare --source <analysis-repo> --auditowl <auditowl-repo> [options]

Options:
  --batch <id>            Batch id (default: r16fix5)
  --out <dir>             Output root (default: ./review-data)
  --inputs <dir>          Paper input snapshot (default: <source>/${DEFAULT_INPUTS})
  --exclude <ids>         Comma-separated paper ids (default: 2254,3680)
  --mode <mode>           copy | hardlink (default: copy)
  --generated-at <iso>    Fixed timestamp for deterministic output
  --force                 Replace an existing non-empty batch directory
  --help                  Show this help

The new batch is built in a temporary sibling directory and only replaces the
target after every source was copied and validated.`)
}

function parseOptions(argv: readonly string[]): Options {
  const options: Options = {
    source: "",
    auditowl: "",
    inputs: null,
    batchId: "r16fix5",
    out: "./review-data",
    exclude: ["2254", "3680"],
    mode: "copy",
    generatedAt: null,
    force: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`)
    }
    const equals = argument.indexOf("=")
    const name = equals >= 0 ? argument.slice(2, equals) : argument.slice(2)
    const inlineValue = equals >= 0 ? argument.slice(equals + 1) : null
    const readValue = (): string => {
      if (inlineValue !== null) {
        return inlineValue
      }
      const next = argv[index + 1]
      if (!next || next.startsWith("--")) {
        throw new Error(`Missing value for --${name}`)
      }
      index += 1
      return next
    }

    switch (name) {
      case "source":
        options.source = readValue()
        break
      case "auditowl":
        options.auditowl = readValue()
        break
      case "inputs":
        options.inputs = readValue()
        break
      case "batch":
        options.batchId = readValue()
        break
      case "out":
        options.out = readValue()
        break
      case "exclude":
        options.exclude = readValue()
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
        break
      case "mode": {
        const mode = readValue()
        if (mode !== "copy" && mode !== "hardlink") {
          throw new Error(`Invalid --mode: ${mode} (allowed: copy, hardlink)`)
        }
        options.mode = mode
        break
      }
      case "generated-at": {
        const value = readValue()
        const timestamp = new Date(value)
        if (Number.isNaN(timestamp.getTime())) {
          throw new Error(`Invalid --generated-at: ${value}`)
        }
        options.generatedAt = timestamp.toISOString()
        break
      }
      case "force":
        options.force = true
        break
      default:
        throw new Error(`Unknown option: --${name}`)
    }
  }

  if (!options.source) {
    throw new Error("--source is required")
  }
  if (!options.auditowl) {
    throw new Error("--auditowl is required")
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(options.batchId)) {
    throw new Error(`Invalid batch id: ${options.batchId}`)
  }
  return options
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await lstat(target)
    return true
  } catch {
    return false
  }
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory()
  } catch {
    return false
  }
}

async function isFile(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isFile()
  } catch {
    return false
  }
}

function isExcludedPath(relative: string): boolean {
  const segments = relative.split("/")
  if (segments.some((segment) => EXCLUDED_DIRECTORIES.has(segment))) {
    return true
  }
  return EXCLUDED_SUFFIXES.some((suffix) => relative.endsWith(suffix))
}

async function transferFile(
  source: string,
  destination: string,
  mode: CopyMode
): Promise<number> {
  const info = await stat(source)
  await mkdir(path.dirname(destination), { recursive: true })
  if (mode === "copy") {
    await copyFile(source, destination)
  } else {
    try {
      await link(await realpath(source), destination)
    } catch (error) {
      const code =
        error instanceof Error && "code" in error
          ? String((error as { code?: unknown }).code)
          : ""
      if (code === "EXDEV" || code === "EPERM" || code === "EMLINK") {
        await copyFile(source, destination)
      } else {
        throw error
      }
    }
  }
  return info.size
}

async function copyEntry(
  source: string,
  destination: string,
  relative: string,
  mode: CopyMode,
  options: CopyOptions,
  stats: CopyStats
): Promise<void> {
  const info = await lstat(source)

  if (info.isSymbolicLink()) {
    let target: string
    try {
      target = await realpath(source)
    } catch {
      stats.skipped += 1
      return
    }
    const targetInfo = await stat(target)
    if (targetInfo.isDirectory()) {
      await copyDirectory(target, destination, relative, mode, options, stats)
    } else if (targetInfo.isFile()) {
      stats.bytes += await transferFile(target, destination, mode)
      stats.files += 1
    }
    return
  }

  if (info.isDirectory()) {
    await copyDirectory(source, destination, relative, mode, options, stats)
    return
  }
  if (!info.isFile()) {
    stats.skipped += 1
    return
  }
  stats.bytes += await transferFile(source, destination, mode)
  stats.files += 1
}

async function copyDirectory(
  source: string,
  destination: string,
  relative: string,
  mode: CopyMode,
  options: CopyOptions,
  stats: CopyStats
): Promise<void> {
  await mkdir(destination, { recursive: true })
  const entries = await readdir(source, { withFileTypes: true })
  entries.sort((left, right) => (left.name < right.name ? -1 : 1))
  for (const entry of entries) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name
    if (isExcludedPath(childRelative)) {
      stats.skipped += 1
      continue
    }
    if (options.skip?.(childRelative, entry.isDirectory())) {
      stats.skipped += 1
      continue
    }
    await copyEntry(
      path.join(source, entry.name),
      path.join(destination, entry.name),
      childRelative,
      mode,
      options,
      stats
    )
  }
}

async function copyPath(
  source: string,
  destination: string,
  relative: string,
  mode: CopyMode,
  stats: CopyStats,
  options: CopyOptions = {}
): Promise<void> {
  await copyEntry(source, destination, relative, mode, options, stats)
}

async function copySingleFile(
  source: string,
  destination: string,
  mode: CopyMode,
  stats: CopyStats,
  label: string
): Promise<void> {
  if (!(await isFile(source))) {
    throw new Error(`Missing ${label}: ${source}`)
  }
  stats.bytes += await transferFile(source, destination, mode)
  stats.files += 1
}

async function sha256File(target: string): Promise<string> {
  return sha256Bytes(await readFile(target))
}

async function readJson(target: string): Promise<unknown> {
  return JSON.parse(await readFile(target, "utf8")) as unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {}
  }
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      result[key] = entry
    }
  }
  return result
}

async function readGitRevisions(
  runDir: string
): Promise<Record<string, string>> {
  const revisions: Record<string, string> = {}
  const runJsonPath = path.join(runDir, "run.json")
  if (await isFile(runJsonPath)) {
    const runJson = await readJson(runJsonPath)
    if (isRecord(runJson) && isRecord(runJson.input_snapshot)) {
      Object.assign(
        revisions,
        stringRecord(runJson.input_snapshot.git_revisions)
      )
    }
  }
  const repoRevisionsPath = path.join(runDir, "repo_revisions.json")
  if (await isFile(repoRevisionsPath)) {
    Object.assign(revisions, stringRecord(await readJson(repoRevisionsPath)))
  }
  return revisions
}

interface SourceLocations {
  runDir: string
  inputDir: string
  auditowlDir: string
}

async function discoverRunDirs(
  sourceRoot: string,
  batchId: string
): Promise<Map<string, string>> {
  const reviewsRoot = path.join(sourceRoot, "review-agent", "runs", "reviews")
  if (!(await isDirectory(reviewsRoot))) {
    throw new Error(`Review runs directory not found: ${reviewsRoot}`)
  }
  const suffix = `-dsv41-${batchId}`
  const result = new Map<string, string>()
  const entries = await readdir(reviewsRoot, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith(suffix)) {
      continue
    }
    const paperId = entry.name.slice(0, -suffix.length)
    if (!/^\d+$/.test(paperId)) {
      continue
    }
    if (result.has(paperId)) {
      throw new Error(`Duplicate review run for paper ${paperId}`)
    }
    result.set(paperId, path.join(reviewsRoot, entry.name))
  }
  return result
}

async function resolveInputDir(
  inputsRoot: string,
  paperId: string
): Promise<string> {
  const candidates = [
    path.join(inputsRoot, "papers", paperId),
    path.join(inputsRoot, paperId),
  ]
  for (const candidate of candidates) {
    if (await isFile(path.join(candidate, "paper.json"))) {
      return candidate
    }
  }
  throw new Error(
    `Paper input directory not found for ${paperId} under ${inputsRoot}`
  )
}

async function resolveSourceLocations(
  inputsRoot: string,
  auditowlRoot: string,
  paperId: string,
  runDir: string
): Promise<SourceLocations> {
  const inputDir = await resolveInputDir(inputsRoot, paperId)
  const auditowlDir = path.join(auditowlRoot, "audits", paperId)
  if (!(await isDirectory(auditowlDir))) {
    throw new Error(`AuditOwl directory not found: ${auditowlDir}`)
  }
  return { runDir, inputDir, auditowlDir }
}

function codeRepoRole(name: string, commit: string | null): CodeRepoRole {
  if (/^supplement/i.test(name)) {
    return "supplement"
  }
  return commit ? "repository" : "workspace"
}

async function listCodeRepos(
  inputDir: string,
  revisions: Record<string, string>
): Promise<PaperManifest["code"]> {
  const codeRoot = path.join(inputDir, "code")
  if (!(await isDirectory(codeRoot))) {
    return []
  }
  const entries = await readdir(codeRoot, { withFileTypes: true })
  const repos: PaperManifest["code"] = []
  for (const entry of entries) {
    if (!(await isDirectory(path.join(codeRoot, entry.name)))) {
      continue
    }
    const commit = revisions[entry.name] ?? null
    repos.push({
      name: entry.name,
      dir: `code/${entry.name}`,
      role: codeRepoRole(entry.name, commit),
      commit,
    })
  }
  repos.sort((left, right) => (left.name < right.name ? -1 : 1))
  return repos
}

function runSkip(relative: string, isDirectory: boolean): boolean {
  const segments = relative.split("/")
  if (segments.length === 1) {
    if (isDirectory) {
      return TRANSIENT_RUN_DIRECTORIES.has(relative)
    }
    if (relative === ".run.lock") {
      return true
    }
    return !(
      KEPT_RUN_FILES.has(relative) || /^audit(?:-\d+)?\.md$/.test(relative)
    )
  }
  if (segments.length === 2 && segments[1] === "work") {
    return false
  }
  if (segments.length === 2) {
    return true
  }
  if (segments[1] !== "work" || segments.length <= 2) {
    return true
  }
  const top = segments[2]
  return !(
    top === "_audit_code" ||
    top.startsWith("_audit_code_") ||
    top.startsWith("_verifier_code")
  )
}

async function preparePaper(
  paperId: string,
  locations: SourceLocations,
  paperDir: string,
  mode: CopyMode,
  stats: CopyStats
): Promise<{
  manifest: PaperManifest
  overlap: Overlap
  findings: { agent: Finding[]; auditowl: Finding[] }
}> {
  const paperRoot = path.join(paperDir, paperId)
  await mkdir(paperRoot, { recursive: true })

  const agentAudit = path.join(locations.runDir, "audit.md")
  if (!(await isFile(agentAudit))) {
    throw new Error(`Missing agent report audit.md for paper ${paperId}`)
  }
  const auditowlAudit = path.join(locations.auditowlDir, "audit.md")
  if (!(await isFile(auditowlAudit))) {
    throw new Error(`Missing AuditOwl report audit.md for paper ${paperId}`)
  }

  const overlapSource = path.join(locations.runDir, "overlap.json")
  const agentFindingsSource = path.join(
    locations.runDir,
    "findings_verified.json"
  )
  const auditowlFindingsSource = path.join(
    locations.auditowlDir,
    "findings_verified.json"
  )

  const overlapTarget = path.join(paperRoot, "overlap.json")
  const agentFindingsTarget = path.join(paperRoot, "findings.agent.json")
  const auditowlFindingsTarget = path.join(paperRoot, "findings.auditowl.json")

  await copySingleFile(
    overlapSource,
    overlapTarget,
    mode,
    stats,
    "overlap.json"
  )
  await copySingleFile(
    agentFindingsSource,
    agentFindingsTarget,
    mode,
    stats,
    "agent findings_verified.json"
  )
  await copySingleFile(
    auditowlFindingsSource,
    auditowlFindingsTarget,
    mode,
    stats,
    "AuditOwl findings_verified.json"
  )

  for (const file of ["paper.json", "paper_text.txt", "paper.pdf"]) {
    await copySingleFile(
      path.join(locations.inputDir, file),
      path.join(paperRoot, file),
      mode,
      stats,
      `paper input ${file}`
    )
  }
  const paperMetadata = paperMetadataSchema.safeParse(
    await readJson(path.join(paperRoot, "paper.json"))
  )
  if (!paperMetadata.success) {
    throw new Error(
      `paper.json is invalid for paper ${paperId}: ${paperMetadata.error.issues
        .map((issue) => issue.message)
        .join("; ")}`
    )
  }

  const codeSource = path.join(locations.inputDir, "code")
  if (await isDirectory(codeSource)) {
    await copyPath(
      codeSource,
      path.join(paperRoot, "code"),
      "code",
      mode,
      stats
    )
  }

  await copyPath(
    locations.runDir,
    path.join(paperRoot, "run"),
    "",
    mode,
    stats,
    { skip: runSkip }
  )

  const auditowlTarget = path.join(paperRoot, "auditowl")
  await mkdir(auditowlTarget, { recursive: true })
  for (const file of [
    "audit.md",
    "findings_verified.json",
    "metadata.txt",
    "repo_provenance.json",
  ]) {
    const source = path.join(locations.auditowlDir, file)
    if (await isFile(source)) {
      await copySingleFile(
        source,
        path.join(auditowlTarget, file),
        mode,
        stats,
        `AuditOwl ${file}`
      )
    }
  }
  const auditowlEntries = await readdir(locations.auditowlDir, {
    withFileTypes: true,
  })
  for (const entry of auditowlEntries) {
    if (
      entry.isDirectory() &&
      (entry.name === "_audit_code" || entry.name.startsWith("_verifier_code"))
    ) {
      await copyPath(
        path.join(locations.auditowlDir, entry.name),
        path.join(auditowlTarget, entry.name),
        entry.name,
        mode,
        stats
      )
    }
  }

  const overlap = overlapSchema.parse(await readJson(overlapTarget))
  const agentFile = findingsFileSchema.parse(
    await readJson(agentFindingsTarget)
  )
  const auditowlFile = findingsFileSchema.parse(
    await readJson(auditowlFindingsTarget)
  )

  const revisions = await readGitRevisions(locations.runDir)
  const code = await listCodeRepos(locations.inputDir, revisions)

  const manifest: PaperManifest = {
    id: paperId,
    title: overlap.paper.title,
    category: overlap.paper.category,
    auditowlStatus: overlap.paper.auditowl_status,
    comparisonEligible: overlap.paper.comparison_eligible,
    scopeNote: overlap.paper.scope_note ?? null,
    dir: `papers/${paperId}`,
    files: {
      overlap: "overlap.json",
      agentFindings: "findings.agent.json",
      auditowlFindings: "findings.auditowl.json",
      paper: "paper.json",
      paperText: "paper_text.txt",
      paperPdf: "paper.pdf",
      agentRun: "run",
      auditowlDir: "auditowl",
    },
    code,
    sha256: {
      overlap: await sha256File(overlapTarget),
      agentFindings: await sha256File(agentFindingsTarget),
      auditowlFindings: await sha256File(auditowlFindingsTarget),
    },
    counts: {
      clusters: 0,
      agentOnly: 0,
      auditowlOnly: 0,
      related: 0,
      bySeverity: { high: 0, medium: 0, low: 0 },
    },
  }

  return {
    manifest,
    overlap,
    findings: {
      agent: agentFile.findings,
      auditowl: auditowlFile.findings,
    },
  }
}

async function runOverlapValidator(
  sourceRoot: string,
  overlapPaths: readonly string[]
): Promise<void> {
  const pythonCheck = spawnSync("python3", ["--version"], {
    encoding: "utf8",
  })
  if (pythonCheck.error || pythonCheck.status !== 0) {
    console.warn("python3 is not available; skipping validate_overlap.py")
    return
  }
  const validator = path.join(
    sourceRoot,
    "review-agent",
    "scripts",
    "validate_overlap.py"
  )
  if (!(await isFile(validator))) {
    console.warn(`validate_overlap.py not found at ${validator}; skipping`)
    return
  }
  const result = spawnSync("python3", [validator, ...overlapPaths, "--quiet"], {
    encoding: "utf8",
  })
  if (result.stdout) {
    process.stdout.write(result.stdout)
  }
  if (result.stderr) {
    process.stderr.write(result.stderr)
  }
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(
      `validate_overlap.py failed with exit code ${result.status ?? "unknown"}`
    )
  }
  console.log("validate_overlap.py: OK")
}

function formatNumber(value: number, width: number): string {
  return String(value).padStart(width)
}

function printSummary(
  manifests: readonly PaperManifest[],
  stats: CopyStats,
  excluded: readonly ExcludedPaper[]
): void {
  console.log("")
  console.log(
    [
      "paper".padEnd(8),
      "items".padStart(6),
      "H".padStart(4),
      "M".padStart(4),
      "L".padStart(4),
      "clusters".padStart(9),
      "new".padStart(6),
      "owl".padStart(6),
      "related".padStart(8),
    ].join(" ")
  )
  for (const manifest of manifests) {
    const counts = manifest.counts
    const total =
      counts.bySeverity.high + counts.bySeverity.medium + counts.bySeverity.low
    console.log(
      [
        manifest.id.padEnd(8),
        formatNumber(total, 6),
        formatNumber(counts.bySeverity.high, 4),
        formatNumber(counts.bySeverity.medium, 4),
        formatNumber(counts.bySeverity.low, 4),
        formatNumber(counts.clusters, 9),
        formatNumber(counts.agentOnly, 6),
        formatNumber(counts.auditowlOnly, 6),
        formatNumber(counts.related, 8),
      ].join(" ")
    )
  }

  const totalItems = manifests.reduce((sum, manifest) => {
    const counts = manifest.counts
    return (
      sum +
      counts.bySeverity.high +
      counts.bySeverity.medium +
      counts.bySeverity.low
    )
  }, 0)
  console.log("")
  console.log(
    `${manifests.length} papers, ${totalItems} items, ${stats.files} files copied, ${(
      stats.bytes /
      1024 /
      1024
    ).toFixed(1)} MB`
  )
  if (stats.skipped > 0) {
    console.log(
      `${stats.skipped} entries skipped (excluded or broken symlinks)`
    )
  }
  if (excluded.length > 0) {
    console.log(
      `excluded: ${excluded
        .map((entry) => `${entry.paperId} (${entry.reason})`)
        .join(", ")}`
    )
  }
}

async function readExistingBatch(batchDir: string): Promise<Batch | null> {
  try {
    const parsed = batchSchema.safeParse(
      JSON.parse(await readFile(path.join(batchDir, "batch.json"), "utf8"))
    )
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

async function replaceDirectory(
  tempDir: string,
  targetDir: string
): Promise<void> {
  const backupDir = `${targetDir}.bak-${randomUUID().slice(0, 8)}`
  if (!(await pathExists(targetDir))) {
    await rename(tempDir, targetDir)
    return
  }
  await rename(targetDir, backupDir)
  try {
    await rename(tempDir, targetDir)
  } catch (error) {
    await rename(backupDir, targetDir)
    throw error
  }
  await rm(backupDir, { recursive: true, force: true })
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage()
    return
  }

  const options = parseOptions(argv)
  const sourceRoot = path.resolve(options.source)
  const auditowlRoot = path.resolve(options.auditowl)
  const inputsRoot = path.resolve(
    options.inputs ?? path.join(sourceRoot, DEFAULT_INPUTS)
  )
  const outRoot = path.resolve(options.out)
  const batchDir = path.join(outRoot, options.batchId)

  if (!(await isDirectory(sourceRoot))) {
    throw new Error(`Source repository not found: ${sourceRoot}`)
  }
  if (!(await isDirectory(auditowlRoot))) {
    throw new Error(`AuditOwl repository not found: ${auditowlRoot}`)
  }
  if (!(await isDirectory(inputsRoot))) {
    throw new Error(`Paper inputs directory not found: ${inputsRoot}`)
  }

  if (await pathExists(batchDir)) {
    if (!(await isDirectory(batchDir))) {
      throw new Error(`Output path is not a directory: ${batchDir}`)
    }
    const entries = await readdir(batchDir)
    if (entries.length > 0 && !options.force) {
      throw new Error(
        `Batch directory is not empty: ${batchDir} (use --force to replace it)`
      )
    }
  }

  await mkdir(outRoot, { recursive: true })
  const tempDir = path.join(
    outRoot,
    `.${options.batchId}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`
  )

  try {
    await mkdir(tempDir, { recursive: false })

    const excludedSet = new Set(options.exclude)
    const excluded: ExcludedPaper[] = options.exclude.map((paperId) => ({
      paperId,
      reason:
        EXCLUDED_REASONS[paperId] ??
        "excluded by the prepare-review-data command",
    }))

    const runDirs = await discoverRunDirs(sourceRoot, options.batchId)
    const includedIds = [...runDirs.keys()]
      .filter((paperId) => !excludedSet.has(paperId))
      .sort((left, right) => Number(left) - Number(right))

    if (includedIds.length === 0) {
      throw new Error("No review runs matched the requested batch")
    }

    console.log(
      `Preparing ${includedIds.length} papers into ${batchDir} (${options.mode})`
    )

    const stats: CopyStats = { bytes: 0, files: 0, skipped: 0 }
    const paperInputs: PaperInput[] = []
    const manifests: PaperManifest[] = []
    const overlapPaths: string[] = []

    for (const paperId of includedIds) {
      const runDir = runDirs.get(paperId)
      if (!runDir) {
        continue
      }
      process.stdout.write(`  ${paperId} ... `)
      const locations = await resolveSourceLocations(
        inputsRoot,
        auditowlRoot,
        paperId,
        runDir
      )
      const prepared = await preparePaper(
        paperId,
        locations,
        path.join(tempDir, "papers"),
        options.mode,
        stats
      )
      paperInputs.push({
        manifest: prepared.manifest,
        overlap: prepared.overlap,
        agentFindings: prepared.findings.agent,
        auditowlFindings: prepared.findings.auditowl,
      })
      manifests.push(prepared.manifest)
      overlapPaths.push(path.join(locations.runDir, "overlap.json"))
      console.log("ok")
    }

    await runOverlapValidator(sourceRoot, overlapPaths)

    const built = buildReviewData({ papers: paperInputs, excluded })
    if (built.issues.length > 0) {
      console.error("")
      console.error("Cross-file validation failed:")
      for (const issue of built.issues) {
        console.error(
          `  ${issue.paperId || "batch"} ${issue.code}: ${issue.message}`
        )
      }
      throw new Error(`${built.issues.length} validation issue(s)`)
    }

    const builtById = new Map(
      built.papers.map((paper) => [paper.manifest.id, paper])
    )
    for (const manifest of manifests) {
      const paper = builtById.get(manifest.id)
      if (!paper) {
        throw new Error(`No build result for paper ${manifest.id}`)
      }
      manifest.counts = {
        clusters: paper.counts.clusters,
        agentOnly: paper.counts.agentOnly,
        auditowlOnly: paper.counts.auditowlOnly,
        related: paper.counts.related,
        bySeverity: {
          high: paper.counts.bySeverity.high,
          medium: paper.counts.bySeverity.medium,
          low: paper.counts.bySeverity.low,
        },
      }
    }

    manifests.sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0
    )

    const batchWithoutFingerprint = {
      schemaVersion: 1 as const,
      batchId: options.batchId,
      label: `NeurIPS r16 · review-agent dsv41-${options.batchId} vs AuditOwl`,
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      protocol: {
        name: `neurips-16-overlap-${options.batchId}`,
        version: "1",
        path: `docs/experiments/neurips-16-overlap-${options.batchId}.md`,
      },
      excluded,
      papers: manifests,
    }
    const contentSha256 = batchContentFingerprint(batchWithoutFingerprint)

    if (!options.generatedAt) {
      const existing = await readExistingBatch(batchDir)
      if (existing && batchContentFingerprint(existing) === contentSha256) {
        batchWithoutFingerprint.generatedAt = existing.generatedAt
      }
    }

    const batch: Batch = { ...batchWithoutFingerprint, contentSha256 }
    batchSchema.parse(batch)
    await writeFile(
      path.join(tempDir, "batch.json"),
      `${JSON.stringify(batch, null, 2)}\n`,
      "utf8"
    )

    await replaceDirectory(tempDir, batchDir)
    printSummary(manifests, stats, excluded)
    console.log(`contentSha256: ${contentSha256}`)
    console.log(`generatedAt: ${batch.generatedAt}`)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? `prepare-review-data: ${error.message}` : error
  )
  process.exitCode = 1
})
