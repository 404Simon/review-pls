import "dotenv/config"

import { randomUUID } from "node:crypto"
import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises"
import type { Stats } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { migrate } from "drizzle-orm/better-sqlite3/migrator"

import type { AppDatabase } from "@/db"
import {
  buildDecisionsExport,
  buildReviewDataset,
  exportFileName,
  exportTypeSchema,
  type ExportType,
} from "@/lib/review/export"
import { loadExportData } from "@/lib/review/export-data"
import { ReviewDataError } from "@/lib/review/load"

export interface ExportOptions {
  batchId: string
  type: ExportType
  out: string
  root: string
  databaseUrl: string
  now: number
  /** Replace exports that already exist at this timestamp. */
  force?: boolean
}

interface ParsedArgs {
  help: boolean
  batchId: string | null
  type: ExportType
  out: string
  root: string
  databaseUrl: string | null
  now: number | null
  force: boolean
}

const USAGE = `Usage: pnpm review:export --batch <id> [options]

Write deterministic review exports under <out>/<batch>/.

  --batch <id>          Mounted batch id (required).
  --type <type>         dataset | decisions | both (default: both).
  --out <dir>           Output root (default: ./exports).
  --root <dir>          Review data root (default: REVIEW_DATA_ROOT).
  --database <path>     Existing SQLite database (default: DATABASE_URL or ./local.db).
  --now <epoch-ms>      Export timestamp override (default: now).
  --force               Replace existing exports with the same timestamp.
  --help, -h            Show this help.

The database file must already exist and is migrated idempotently before the
export. Run \`pnpm db:migrate\` if the migration folder is unavailable.

Every requested payload is built and staged before any export file is
installed. Existing files at the same timestamp are refused unless --force is
given; --force backs up and restores them if installation fails.

The full dataset includes drafts, claims, the append-only decision event
history and the complete paper sources (overlap, both findings files and the
built items). The decisions-only file contains final closed decisions plus the
durable unsure history; drafts never appear in it.`

class ExportUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ExportUsageError"
  }
}

function parseType(value: string): ExportType {
  const parsed = exportTypeSchema.safeParse(value)
  if (!parsed.success) {
    throw new ExportUsageError(
      `Unknown export type ${JSON.stringify(value)}; use dataset, decisions or both.`
    )
  }
  return parsed.data
}

function parseNow(value: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ExportUsageError(
      `Invalid --now value ${JSON.stringify(value)}; pass epoch milliseconds.`
    )
  }
  return parsed
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let help = false
  let batchId: string | null = null
  let type: ExportType = "both"
  let out = "./exports"
  let root = process.env.REVIEW_DATA_ROOT ?? "./review-data"
  let databaseUrl: string | null = null
  let now: number | null = null
  let force = false

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--help" || argument === "-h") {
      help = true
      continue
    }
    if (!argument.startsWith("--")) {
      throw new ExportUsageError(`Unexpected argument: ${argument}`)
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
        throw new ExportUsageError(`Missing value for --${name}`)
      }
      index += 1
      return next
    }

    switch (name) {
      case "batch":
        batchId = readValue()
        break
      case "type":
        type = parseType(readValue())
        break
      case "out":
        out = readValue()
        break
      case "root":
        root = readValue()
        break
      case "database":
        databaseUrl = readValue()
        break
      case "now":
        now = parseNow(readValue())
        break
      case "force":
        if (inlineValue !== null) {
          throw new ExportUsageError("--force does not take a value.")
        }
        force = true
        break
      default:
        throw new ExportUsageError(`Unknown option: --${name}`)
    }
  }

  if (help) {
    return { help, batchId, type, out, root, databaseUrl, now, force }
  }
  if (batchId === null || batchId.trim() === "") {
    throw new ExportUsageError("--batch is required.")
  }

  return {
    help,
    batchId,
    type,
    out,
    root,
    databaseUrl: databaseUrl ?? process.env.DATABASE_URL ?? "./local.db",
    now,
    force,
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  )
}

/**
 * `@/db` opens (and would create) the SQLite file at import time. Check first so
 * a typo never leaves an empty database behind and fails later with
 * `no such table`.
 */
async function assertDatabaseFile(databaseUrl: string): Promise<void> {
  const resolved = path.resolve(databaseUrl)
  let info: Stats
  try {
    info = await stat(resolved)
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new Error(
        `Database file ${JSON.stringify(resolved)} does not exist. ` +
          "Create it first with `pnpm db:migrate` (or pass --database with an existing file)."
      )
    }
    throw error
  }
  if (!info.isFile()) {
    throw new Error(
      `Database path ${JSON.stringify(resolved)} is not a regular file.`
    )
  }
}

async function migrateDatabase(db: AppDatabase): Promise<void> {
  const migrationsFolder = path.join(process.cwd(), "drizzle")
  try {
    migrate(db, { migrationsFolder })
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : ""
    throw new Error(
      `Could not apply Drizzle migrations from ${JSON.stringify(migrationsFolder)}. ` +
        `Run \`pnpm db:migrate\` against this database and retry.${detail}`
    )
  }
}

interface ExportFile {
  path: string
  content: string
}

interface InstalledFile {
  final: string
  backup: string | null
  installed: boolean
}

/** Returns the backup path when it could not be removed. */
async function removeBackup(backup: string): Promise<string | null> {
  try {
    await unlink(backup)
    return null
  } catch {
    return backup
  }
}

function refuseExistingExport(target: string): Error {
  return new Error(
    `Refusing to overwrite existing export ${JSON.stringify(target)}. ` +
      "Pass --force to replace it."
  )
}

/**
 * Refuse every collision before anything is written. A directory at a target
 * path is rejected even with `--force`; it is not an export file we can back up
 * and restore.
 */
async function assertTargetsAvailable(
  files: readonly ExportFile[],
  force: boolean
): Promise<void> {
  for (const file of files) {
    let info: Stats
    try {
      info = await stat(file.path)
    } catch (error) {
      if (isMissingFileError(error)) {
        continue
      }
      throw error
    }
    if (!force) {
      throw refuseExistingExport(file.path)
    }
    if (!info.isFile()) {
      throw new Error(
        `Cannot replace ${JSON.stringify(file.path)}: it is not a regular file.`
      )
    }
  }
}

/**
 * Stage every file first, then install each one. Without `--force` an existing
 * target is refused. With `--force` any existing file is moved aside and
 * restored if a later install fails, so cleanup never deletes a pre-existing
 * export.
 */
async function writeExportFiles(
  files: readonly ExportFile[],
  force: boolean
): Promise<void> {
  const staged: { temporary: string; final: string }[] = []
  const changes: InstalledFile[] = []

  const cleanup = async (): Promise<void> => {
    await Promise.allSettled(staged.map((entry) => unlink(entry.temporary)))
    for (const change of [...changes].reverse()) {
      if (change.installed) {
        await unlink(change.final).catch(() => undefined)
      }
      if (change.backup) {
        await rename(change.backup, change.final).catch(() => undefined)
      }
    }
  }

  try {
    for (const file of files) {
      const temporary = `${file.path}.tmp-${process.pid}-${randomUUID()}`
      await writeFile(temporary, file.content, "utf8")
      staged.push({ temporary, final: file.path })
    }

    for (const entry of staged) {
      let backup: string | null = null
      if (force) {
        try {
          const info = await stat(entry.final)
          if (!info.isFile()) {
            throw new Error(
              `Cannot replace ${JSON.stringify(entry.final)}: it is not a regular file.`
            )
          }
          backup = `${entry.final}.bak-${process.pid}-${randomUUID()}`
          await rename(entry.final, backup)
        } catch (error) {
          if (!isMissingFileError(error)) {
            throw error
          }
        }
      } else {
        try {
          await stat(entry.final)
          throw refuseExistingExport(entry.final)
        } catch (error) {
          if (!isMissingFileError(error)) {
            throw error
          }
        }
      }

      const change: InstalledFile = {
        final: entry.final,
        backup,
        installed: false,
      }
      changes.push(change)
      await rename(entry.temporary, entry.final)
      change.installed = true
    }
  } catch (error) {
    await cleanup()
    throw error
  }

  // Removing the backups is best effort: the export itself already succeeded.
  // Surface leftovers instead of silently leaving `.bak-*` files behind.
  const backupPaths = changes.flatMap((change) =>
    change.backup ? [change.backup] : []
  )
  const leftovers = await Promise.all(backupPaths.map(removeBackup))
  for (const leftover of leftovers) {
    if (leftover) {
      console.warn(
        `review:export: could not remove backup ${JSON.stringify(leftover)}; remove it manually.`
      )
    }
  }
}

export async function runExportReviews(
  options: ExportOptions
): Promise<{ datasetPath: string | null; decisionsPath: string | null }> {
  // `@/db` reads DATABASE_URL at import time. Set it before the dynamic import
  // so the CLI can target an explicit database without a wrapper script.
  process.env.DATABASE_URL = options.databaseUrl
  await assertDatabaseFile(options.databaseUrl)
  const { db } = await import("@/db")
  await migrateDatabase(db)
  const data = await loadExportData(db, options.batchId, {
    root: options.root,
    now: options.now,
    includeExpiredClaims: true,
  })

  // Build every requested payload before touching the filesystem so a builder
  // failure cannot leave an earlier file behind.
  const files: ExportFile[] = []
  let datasetPath: string | null = null
  let decisionsPath: string | null = null

  if (options.type === "dataset" || options.type === "both") {
    datasetPath = exportFileName("dataset", options.now)
    files.push({
      path: datasetPath,
      content: `${JSON.stringify(buildReviewDataset(data), null, 2)}\n`,
    })
  }
  if (options.type === "decisions" || options.type === "both") {
    decisionsPath = exportFileName("decisions", options.now)
    files.push({
      path: decisionsPath,
      content: `${JSON.stringify(buildDecisionsExport(data), null, 2)}\n`,
    })
  }

  const directory = path.resolve(options.out, options.batchId)
  const targets = files.map((file) => ({
    path: path.join(directory, file.path),
    content: file.content,
  }))
  const force = options.force === true
  await assertTargetsAvailable(targets, force)
  await mkdir(directory, { recursive: true })
  await writeExportFiles(targets, force)

  return {
    datasetPath: datasetPath ? path.join(directory, datasetPath) : null,
    decisionsPath: decisionsPath ? path.join(directory, decisionsPath) : null,
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE)
    return
  }

  let parsed: ParsedArgs
  try {
    parsed = parseArgs(argv)
  } catch (error) {
    if (error instanceof ExportUsageError) {
      console.error(`review:export: ${error.message}`)
      console.error("")
      console.error(USAGE)
      process.exitCode = 1
      return
    }
    throw error
  }

  if (parsed.batchId === null) {
    throw new Error("--batch is required")
  }

  const result = await runExportReviews({
    batchId: parsed.batchId,
    type: parsed.type,
    out: parsed.out,
    root: parsed.root,
    databaseUrl: parsed.databaseUrl ?? "./local.db",
    now: parsed.now ?? Date.now(),
    force: parsed.force,
  })

  if (result.datasetPath) {
    console.log(`dataset:   ${result.datasetPath}`)
  }
  if (result.decisionsPath) {
    console.log(`decisions: ${result.decisionsPath}`)
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1]
  if (!entry) {
    return false
  }
  return import.meta.url === pathToFileURL(entry).href
}

if (isMainModule()) {
  main().catch((error: unknown) => {
    if (error instanceof ReviewDataError) {
      console.error(`review:export: ${error.message}`)
    } else {
      console.error(
        error instanceof Error ? `review:export: ${error.message}` : error
      )
    }
    process.exitCode = 1
  })
}
