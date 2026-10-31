import { createHash } from "node:crypto"

import type { Batch } from "@/lib/review/types"

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry))
  }
  const record = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(record).sort()) {
    const entry = record[key]
    if (entry !== undefined) {
      result[key] = canonicalize(entry)
    }
  }
  return result
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value)) ?? "null"
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex")
}

export function sha256Bytes(input: Uint8Array): string {
  return createHash("sha256").update(input).digest("hex")
}

export function itemHash(value: unknown): string {
  return sha256Hex(canonicalJson(value))
}

/**
 * Content fingerprint for a batch. `generatedAt` and the stored
 * `contentSha256` are deliberately excluded so a no-op re-prep keeps the same
 * fingerprint and does not stale decisions.
 */
export function batchContentFingerprint(
  batch: Pick<
    Batch,
    "schemaVersion" | "batchId" | "label" | "protocol" | "excluded" | "papers"
  >
): string {
  return itemHash({
    schemaVersion: batch.schemaVersion,
    batchId: batch.batchId,
    label: batch.label,
    protocol: batch.protocol,
    excluded: batch.excluded,
    papers: batch.papers,
  })
}
