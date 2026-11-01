import { randomUUID } from "node:crypto"
import { mkdir, rename, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

import type { AppDatabase } from "@/db"
import {
  buildExportDocument,
  type ExportDocument,
  type ExportDocumentType,
} from "@/lib/review/export-data"
import { listBatches } from "@/lib/review/load"

export const EXPORT_INTERVAL_MS = 60 * 60 * 1000

const EXPORT_TYPES: readonly ExportDocumentType[] = ["dataset", "decisions"]

/**
 * Stable file names for the scheduled export. Unlike the timestamped download
 * and CLI names, these are overwritten on every run, so EXPORT_DIR always holds
 * exactly one dataset and one decisions file per mounted batch.
 */
export function scheduledExportFileName(type: ExportDocumentType): string {
  return type === "dataset" ? "review-dataset.json" : "decisions.json"
}

export interface ScheduledExportOptions {
  db: AppDatabase
  /** Write root; one subdirectory per mounted batch. */
  out: string
  /** Review data root; defaults to REVIEW_DATA_ROOT. */
  root?: string
  /** Epoch milliseconds; kept explicit so tests get deterministic output. */
  now?: number
}

export interface ScheduledExportFailure {
  batchId: string
  message: string
}

export interface ScheduledExportResult {
  exported: { batchId: string; files: string[] }[]
  failed: ScheduledExportFailure[]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Stage every file before installing any of them, so a write failure cannot
 * leave a half-written JSON document behind. The final rename replaces the
 * previous run's file.
 */
async function writeExportFiles(
  directory: string,
  documents: readonly ExportDocument[]
): Promise<string[]> {
  await mkdir(directory, { recursive: true })

  const staged = documents.map((document) => ({
    temporary: path.join(
      directory,
      `${scheduledExportFileName(document.type)}.tmp-${process.pid}-${randomUUID()}`
    ),
    final: path.join(directory, scheduledExportFileName(document.type)),
    content: document.content,
  }))

  try {
    for (const entry of staged) {
      await writeFile(entry.temporary, entry.content, "utf8")
    }
    for (const entry of staged) {
      await rename(entry.temporary, entry.final)
    }
  } catch (error) {
    await Promise.allSettled(staged.map((entry) => unlink(entry.temporary)))
    throw error
  }

  return staged.map((entry) => entry.final)
}

/**
 * One scheduled export pass: export the dataset and the decisions snapshot for
 * every valid mounted batch. A batch that fails is reported and does not stop
 * the remaining batches.
 */
export async function runScheduledExports(
  options: ScheduledExportOptions
): Promise<ScheduledExportResult> {
  const now = options.now ?? Date.now()
  const out = path.resolve(options.out)
  const batches = await listBatches({ root: options.root })
  const result: ScheduledExportResult = { exported: [], failed: [] }

  for (const batch of batches) {
    if (batch.error) {
      result.failed.push({ batchId: batch.batchId, message: batch.error })
      continue
    }

    try {
      const documents: ExportDocument[] = []
      for (const type of EXPORT_TYPES) {
        documents.push(
          await buildExportDocument(options.db, batch.batchId, type, {
            root: options.root,
            now,
          })
        )
      }
      const files = await writeExportFiles(
        path.join(out, batch.batchId),
        documents
      )
      result.exported.push({ batchId: batch.batchId, files })
    } catch (error) {
      result.failed.push({
        batchId: batch.batchId,
        message: errorMessage(error),
      })
    }
  }

  return result
}

let started = false

/**
 * Start the hourly export when EXPORT_DIR is set. Runs once immediately, then
 * every hour; failures are logged and retried on the next tick so a broken
 * mount never takes the server down. A slow run skips ticks instead of
 * overlapping.
 *
 * Called from the Node-only startup path (`src/lib/review/startup.ts`).
 */
export function startScheduledExports(db: AppDatabase): void {
  const configured = process.env.EXPORT_DIR?.trim()
  if (!configured || started) {
    return
  }
  started = true

  let busy = false
  const run = async (): Promise<void> => {
    if (busy) {
      console.warn(
        "Scheduled export is still running; skipping this hourly tick."
      )
      return
    }
    busy = true
    try {
      const result = await runScheduledExports({ db, out: configured })
      for (const entry of result.exported) {
        console.log(
          `Scheduled export for batch ${entry.batchId}: ${entry.files.join(", ")}`
        )
      }
      for (const failure of result.failed) {
        console.error(
          `Scheduled export for batch ${failure.batchId} failed: ${failure.message}`
        )
      }
    } catch (error) {
      console.error(
        `Scheduled export to ${JSON.stringify(configured)} failed; retrying next hour. ${errorMessage(error)}`
      )
    } finally {
      busy = false
    }
  }

  void run()
  const timer = setInterval(() => {
    void run()
  }, EXPORT_INTERVAL_MS)
  // The export timer must not keep the process (or a test runner) alive.
  timer.unref()
}
