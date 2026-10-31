import path from "node:path"

import { isKept } from "@/lib/review/build"
import { latestClosedDecision, isDecisionStale } from "@/lib/review/decisions"
import { loadItems, type LoadedItems } from "@/lib/review/load"
import { resolveEvidence, type QuoteMatch } from "@/lib/review/resolve"
import type {
  DecisionRecord,
  EvidenceSide,
  Finding,
  PaperManifest,
  ReviewItem,
} from "@/lib/review/types"

/** Cached evidence inspection is valid for five minutes; reload clears it. */
export const HEALTH_CACHE_TTL_MS = 5 * 60 * 1000

export interface EvidenceAnchor {
  paperId: string
  side: EvidenceSide
  id: string
  file: string
  quote: string | null
  lineStart: number | null
  lineEnd: number | null
}

export interface AnchorPaper {
  manifest: PaperManifest
  dir: string
  anchors: readonly EvidenceAnchor[]
}

export interface MissingAnchor {
  paperId: string
  side: EvidenceSide
  id: string
  file: string
}

export interface SourceAnomaly extends MissingAnchor {
  lineStart: number | null
  lineEnd: number | null
}

export interface EvidenceHealthSummary {
  /** Local file/check anchors plus URL anchors; *not* missing duplicates. */
  total: number
  local: number
  url: number
  missing: number
  quotes: Record<QuoteMatch, number>
  missingAnchors: MissingAnchor[]
  urlAnchors: MissingAnchor[]
  /** Resolved anchors whose stored quote does not match the cited lines. */
  sourceAnomalies: SourceAnomaly[]
}

function emptyEvidenceHealth(): EvidenceHealthSummary {
  return {
    total: 0,
    local: 0,
    url: 0,
    missing: 0,
    quotes: { exact: 0, fuzzy: 0, missing: 0, not_checkable: 0 },
    missingAnchors: [],
    urlAnchors: [],
    sourceAnomalies: [],
  }
}

/**
 * Resolve and quote-check a set of anchors once. This is the expensive part of
 * the admin data-health page, so callers cache the result instead of rebuilding
 * evidence previews for every item.
 */
export async function inspectEvidenceAnchors(
  batchDir: string,
  papers: readonly AnchorPaper[]
): Promise<EvidenceHealthSummary> {
  const stats = emptyEvidenceHealth()

  for (const paper of papers) {
    const roots = {
      batchRoot: batchDir,
      paperDir: paper.dir,
      repos: paper.manifest.code.map((repo) => ({
        name: repo.name,
        dir: path.join(paper.dir, repo.dir),
      })),
      runDir: path.join(paper.dir, paper.manifest.files.agentRun),
      auditowlDir: path.join(paper.dir, paper.manifest.files.auditowlDir),
    }

    for (const anchor of paper.anchors) {
      stats.total += 1
      const result = await resolveEvidence({
        roots,
        side: anchor.side,
        finding: {
          file: anchor.file,
          quote: anchor.quote,
          lineStart: anchor.lineStart,
          lineEnd: anchor.lineEnd,
        },
      })
      stats.quotes[result.quoteMatch] += 1

      if (result.kind === "url") {
        stats.url += 1
        stats.urlAnchors.push(anchorSummary(anchor))
      } else if (result.kind === "missing") {
        stats.missing += 1
        stats.missingAnchors.push(anchorSummary(anchor))
      } else {
        stats.local += 1
        if (result.quoteMatch === "missing") {
          stats.sourceAnomalies.push({
            ...anchorSummary(anchor),
            lineStart: anchor.lineStart,
            lineEnd: anchor.lineEnd,
          })
        }
      }
    }
  }

  return stats
}

function anchorSummary(anchor: EvidenceAnchor): MissingAnchor {
  return {
    paperId: anchor.paperId,
    side: anchor.side,
    id: anchor.id,
    file: anchor.file,
  }
}

function findingAnchor(
  paperId: string,
  side: EvidenceSide,
  finding: {
    idLocal: string
    file: string
    quote: string | null
    lineStart: number | null
    lineEnd: number | null
  }
): EvidenceAnchor {
  return {
    paperId,
    side,
    id: finding.idLocal,
    file: finding.file,
    quote: finding.quote,
    lineStart: finding.lineStart,
    lineEnd: finding.lineEnd,
  }
}

/**
 * Collect each kept finding once from the built items. Related pairs reuse
 * findings that also appear in an `*_only` item, so the dedupe is deliberate.
 */
export function anchorsFromLoadedItems(loaded: LoadedItems): AnchorPaper[] {
  return loaded.papers.map((paper) => {
    const seen = new Set<string>()
    const anchors: EvidenceAnchor[] = []
    for (const item of paper.items) {
      for (const side of ["auditowl", "agent"] as const) {
        for (const finding of item.findings[side]) {
          const key = `${side}\u0000${finding.idLocal}`
          if (seen.has(key)) {
            continue
          }
          seen.add(key)
          anchors.push(
            findingAnchor(paper.manifest.id, side, {
              idLocal: finding.idLocal,
              file: finding.file,
              quote: finding.quote,
              lineStart: finding.lineStart,
              lineEnd: finding.lineEnd,
            })
          )
        }
      }
    }
    return {
      manifest: paper.manifest,
      dir: path.join(loaded.batch.dir, paper.manifest.dir),
      anchors,
    }
  })
}

/** Convert raw findings (the data check) into the same anchor input. */
export function anchorsFromFindings(
  paperId: string,
  manifest: PaperManifest,
  dir: string,
  sides: ReadonlyArray<{ side: EvidenceSide; findings: readonly Finding[] }>
): AnchorPaper {
  const anchors: EvidenceAnchor[] = []
  for (const current of sides) {
    for (const finding of current.findings) {
      if (!isKept(finding)) {
        continue
      }
      anchors.push(
        findingAnchor(paperId, current.side, {
          idLocal: finding.id_local ?? finding.id,
          file: finding.file,
          quote: finding.quote ?? null,
          lineStart: finding.line_start ?? null,
          lineEnd: finding.line_end ?? null,
        })
      )
    }
  }
  return { manifest, dir, anchors }
}

export interface BatchInspection {
  loaded: LoadedItems
  evidence: EvidenceHealthSummary
  inspectedAt: number
}

interface CacheEntry {
  startedAt: number
  promise: Promise<BatchInspection>
}

const inspectionCache = new Map<string, CacheEntry>()

function cacheKey(batchId: string, root: string | undefined): string {
  // Plain concatenation only: resolving a runtime path here makes Turbopack
  // trace the whole project as server input.
  return `${root ?? process.env.REVIEW_DATA_ROOT ?? ""}\u0000${batchId}`
}

async function inspectUncached(
  batchId: string,
  root: string | undefined,
  now: number
): Promise<BatchInspection> {
  const loaded = await loadItems(batchId, { root })
  const evidence = await inspectEvidenceAnchors(
    loaded.batch.dir,
    anchorsFromLoadedItems(loaded)
  )
  return { loaded, evidence, inspectedAt: now }
}

/**
 * Cached batch inspection for the admin console. The cache stores the promise
 * so two requests for the same batch share one filesystem walk.
 */
export async function inspectBatchHealth(
  batchId: string,
  options: { root?: string; now?: number } = {}
): Promise<BatchInspection> {
  const now = options.now ?? Date.now()
  const key = cacheKey(batchId, options.root)
  const cached = inspectionCache.get(key)
  if (cached && now - cached.startedAt < HEALTH_CACHE_TTL_MS) {
    return cached.promise
  }

  const entry: CacheEntry = {
    startedAt: now,
    promise: inspectUncached(batchId, options.root, now),
  }
  inspectionCache.set(key, entry)
  try {
    return await entry.promise
  } catch (error) {
    inspectionCache.delete(key)
    throw error
  }
}

export function clearDataHealthCache(): void {
  inspectionCache.clear()
}

export interface DecisionHealth {
  /** Latest closed decision per item whose source hash changed. */
  stale: DecisionRecord[]
  /** Decision rows for items that no longer exist in the mounted batch. */
  orphaned: DecisionRecord[]
}

function itemKey(paperId: string, kind: string, ref: string): string {
  return `${paperId}\u0000${kind}\u0000${ref}`
}

function compareDecisionKey(a: DecisionRecord, b: DecisionRecord): number {
  return (
    a.paperId.localeCompare(b.paperId) ||
    a.itemKind.localeCompare(b.itemKind) ||
    a.itemRef.localeCompare(b.itemRef) ||
    a.userId.localeCompare(b.userId) ||
    a.updatedAt - b.updatedAt ||
    a.id.localeCompare(b.id)
  )
}

/** Pure stale/orphan analysis; the item hashes come from the cached inspection. */
export function summarizeDecisionHealth(
  items: readonly ReviewItem[],
  decisions: readonly DecisionRecord[],
  manifestSha256: string
): DecisionHealth {
  const itemByKey = new Map<string, ReviewItem>()
  for (const item of items) {
    itemByKey.set(itemKey(item.paperId, item.kind, item.ref), item)
  }

  const grouped = new Map<string, DecisionRecord[]>()
  const orphaned: DecisionRecord[] = []
  for (const decision of decisions) {
    const key = itemKey(decision.paperId, decision.itemKind, decision.itemRef)
    if (!itemByKey.has(key)) {
      orphaned.push(decision)
      continue
    }
    const bucket = grouped.get(key)
    if (bucket) {
      bucket.push(decision)
    } else {
      grouped.set(key, [decision])
    }
  }

  const stale: DecisionRecord[] = []
  for (const [key, rows] of grouped) {
    const item = itemByKey.get(key)
    const final = latestClosedDecision(rows)
    if (
      item &&
      final &&
      isDecisionStale(final, item.itemHash, manifestSha256)
    ) {
      stale.push(final)
    }
  }

  return {
    stale: stale.sort(compareDecisionKey),
    orphaned: orphaned.sort(compareDecisionKey),
  }
}
