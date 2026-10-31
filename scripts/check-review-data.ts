import { pathToFileURL } from "node:url"

import {
  anchorsFromFindings,
  inspectEvidenceAnchors,
} from "@/lib/review/data-health"
import { loadItems, loadPaper } from "@/lib/review/load"
import type { ReviewCounts } from "@/lib/review/types"

interface Options {
  root: string
  batchId: string
}

interface ExpectedPaper {
  high: number
  medium: number
  low: number
  total: number
  clusters: number
  agentOnly: number
  auditowlOnly: number
  related: number
}

const EXPECTED_TOTAL = {
  papers: 14,
  excluded: 2,
  total: 249,
  high: 47,
  medium: 111,
  low: 91,
  clusters: 66,
  agentOnly: 166,
  auditowlOnly: 12,
  related: 5,
} as const

const EXPECTED_PAPERS: Readonly<Record<string, ExpectedPaper>> = {
  "654": {
    high: 5,
    medium: 9,
    low: 7,
    total: 21,
    clusters: 5,
    agentOnly: 16,
    auditowlOnly: 0,
    related: 0,
  },
  "1171": {
    high: 3,
    medium: 6,
    low: 4,
    total: 13,
    clusters: 5,
    agentOnly: 8,
    auditowlOnly: 0,
    related: 0,
  },
  "1274": {
    high: 1,
    medium: 3,
    low: 5,
    total: 9,
    clusters: 4,
    agentOnly: 5,
    auditowlOnly: 0,
    related: 0,
  },
  "1333": {
    high: 8,
    medium: 4,
    low: 5,
    total: 17,
    clusters: 8,
    agentOnly: 9,
    auditowlOnly: 0,
    related: 0,
  },
  "1800": {
    high: 0,
    medium: 2,
    low: 7,
    total: 9,
    clusters: 2,
    agentOnly: 7,
    auditowlOnly: 0,
    related: 0,
  },
  "1829": {
    high: 2,
    medium: 14,
    low: 12,
    total: 28,
    clusters: 3,
    agentOnly: 22,
    auditowlOnly: 2,
    related: 1,
  },
  "1867": {
    high: 2,
    medium: 11,
    low: 8,
    total: 21,
    clusters: 3,
    agentOnly: 16,
    auditowlOnly: 2,
    related: 0,
  },
  "2167": {
    high: 3,
    medium: 14,
    low: 7,
    total: 24,
    clusters: 7,
    agentOnly: 15,
    auditowlOnly: 1,
    related: 1,
  },
  "2188": {
    high: 8,
    medium: 11,
    low: 8,
    total: 27,
    clusters: 5,
    agentOnly: 20,
    auditowlOnly: 1,
    related: 1,
  },
  "2278": {
    high: 2,
    medium: 12,
    low: 6,
    total: 20,
    clusters: 4,
    agentOnly: 13,
    auditowlOnly: 2,
    related: 1,
  },
  "2963": {
    high: 2,
    medium: 3,
    low: 6,
    total: 11,
    clusters: 4,
    agentOnly: 6,
    auditowlOnly: 1,
    related: 0,
  },
  "3764": {
    high: 2,
    medium: 5,
    low: 3,
    total: 10,
    clusters: 5,
    agentOnly: 4,
    auditowlOnly: 1,
    related: 0,
  },
  "4523": {
    high: 5,
    medium: 11,
    low: 4,
    total: 20,
    clusters: 6,
    agentOnly: 14,
    auditowlOnly: 0,
    related: 0,
  },
  "4647": {
    high: 4,
    medium: 6,
    low: 9,
    total: 19,
    clusters: 5,
    agentOnly: 11,
    auditowlOnly: 2,
    related: 1,
  },
}

function printUsage(): void {
  console.log(
    "Usage: pnpm review-data:check [--root ./review-data] [--batch r16fix5]"
  )
}

function parseOptions(argv: readonly string[]): Options {
  const options: Options = {
    root: process.env.REVIEW_DATA_ROOT ?? "./review-data",
    batchId: "r16fix5",
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
    if (name === "root") {
      options.root = readValue()
    } else if (name === "batch") {
      options.batchId = readValue()
    } else {
      throw new Error(`Unknown option: --${name}`)
    }
  }
  return options
}

function countRows(counts: ReviewCounts): {
  high: number
  medium: number
  low: number
  total: number
  clusters: number
  agentOnly: number
  auditowlOnly: number
  related: number
} {
  return {
    high: counts.bySeverity.high,
    medium: counts.bySeverity.medium,
    low: counts.bySeverity.low,
    total: counts.total,
    clusters: counts.clusters,
    agentOnly: counts.agentOnly,
    auditowlOnly: counts.auditowlOnly,
    related: counts.related,
  }
}

interface CountValues {
  high: number
  medium: number
  low: number
  total: number
  clusters: number
  agentOnly: number
  auditowlOnly: number
  related: number
}

// Exported for unit tests: verifies the expected counts, the per-severity
// values stored in batch.json, and the per-kind values.
export function comparePaperCounts(
  paperId: string,
  actual: CountValues,
  expected: CountValues | undefined,
  manifest: CountValues
): string[] {
  if (!expected) {
    return [`unexpected included paper ${paperId}`]
  }
  const failures: string[] = []
  for (const key of [
    "high",
    "medium",
    "low",
    "total",
    "clusters",
    "agentOnly",
    "auditowlOnly",
    "related",
  ] as const) {
    if (actual[key] !== expected[key]) {
      failures.push(
        `paper ${paperId} ${key}: expected ${expected[key]}, got ${actual[key]}`
      )
    }
  }
  for (const severity of ["high", "medium", "low"] as const) {
    if (manifest[severity] !== actual[severity]) {
      failures.push(
        `paper ${paperId} batch.json bySeverity.${severity}: ` +
          `expected ${actual[severity]}, got ${manifest[severity]}`
      )
    }
  }
  const manifestTotal = manifest.high + manifest.medium + manifest.low
  if (
    manifestTotal !== actual.total ||
    manifest.clusters !== actual.clusters ||
    manifest.agentOnly !== actual.agentOnly ||
    manifest.auditowlOnly !== actual.auditowlOnly ||
    manifest.related !== actual.related
  ) {
    failures.push(
      `paper ${paperId} batch.json counts do not match the built items`
    )
  }
  return failures
}

function formatCell(value: number, width: number): string {
  return String(value).padStart(width)
}

function printTable(
  rows: Array<{
    paperId: string
    actual: ReturnType<typeof countRows>
    expected: ExpectedPaper | undefined
  }>
): void {
  console.log(
    [
      "paper".padEnd(8),
      "H".padStart(4),
      "M".padStart(4),
      "L".padStart(4),
      "total".padStart(6),
      "clusters".padStart(9),
      "new".padStart(6),
      "owl".padStart(6),
      "related".padStart(8),
      "status".padStart(8),
    ].join(" ")
  )
  for (const row of rows) {
    const { actual, expected } = row
    const matches =
      expected !== undefined &&
      actual.high === expected.high &&
      actual.medium === expected.medium &&
      actual.low === expected.low &&
      actual.total === expected.total &&
      actual.clusters === expected.clusters &&
      actual.agentOnly === expected.agentOnly &&
      actual.auditowlOnly === expected.auditowlOnly &&
      actual.related === expected.related
    console.log(
      [
        row.paperId.padEnd(8),
        formatCell(actual.high, 4),
        formatCell(actual.medium, 4),
        formatCell(actual.low, 4),
        formatCell(actual.total, 6),
        formatCell(actual.clusters, 9),
        formatCell(actual.agentOnly, 6),
        formatCell(actual.auditowlOnly, 6),
        formatCell(actual.related, 8),
        (matches ? "ok" : "FAIL").padStart(8),
      ].join(" ")
    )
  }
}

function checkTotal(
  failures: string[],
  label: string,
  actual: number,
  expected: number
): void {
  if (actual !== expected) {
    failures.push(`${label}: expected ${expected}, got ${actual}`)
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage()
    return
  }

  const options = parseOptions(argv)
  const failures: string[] = []

  const loaded = await loadItems(options.batchId, { root: options.root })
  const papers = await Promise.all(
    loaded.batch.papers.map((manifest) =>
      loadPaper(options.batchId, manifest.id, { root: options.root })
    )
  )

  const excludedIds = new Set(
    loaded.batch.excluded.map((entry) => entry.paperId)
  )

  checkTotal(
    failures,
    "included papers",
    loaded.batch.papers.length,
    EXPECTED_TOTAL.papers
  )
  checkTotal(
    failures,
    "excluded papers",
    loaded.batch.excluded.length,
    EXPECTED_TOTAL.excluded
  )
  checkTotal(failures, "items", loaded.counts.total, EXPECTED_TOTAL.total)
  checkTotal(
    failures,
    "high",
    loaded.counts.bySeverity.high,
    EXPECTED_TOTAL.high
  )
  checkTotal(
    failures,
    "medium",
    loaded.counts.bySeverity.medium,
    EXPECTED_TOTAL.medium
  )
  checkTotal(failures, "low", loaded.counts.bySeverity.low, EXPECTED_TOTAL.low)
  checkTotal(
    failures,
    "clusters",
    loaded.counts.clusters,
    EXPECTED_TOTAL.clusters
  )
  checkTotal(
    failures,
    "agent-only",
    loaded.counts.agentOnly,
    EXPECTED_TOTAL.agentOnly
  )
  checkTotal(
    failures,
    "AuditOwl-only",
    loaded.counts.auditowlOnly,
    EXPECTED_TOTAL.auditowlOnly
  )
  checkTotal(failures, "related", loaded.counts.related, EXPECTED_TOTAL.related)

  for (const entry of loaded.batch.excluded) {
    if (!entry.reason.trim()) {
      failures.push(`excluded paper ${entry.paperId} has no reason`)
    }
  }
  for (const paperId of ["2254", "3680"]) {
    if (!excludedIds.has(paperId)) {
      failures.push(`excluded paper ${paperId} is missing from batch.json`)
    }
  }
  for (const paperId of Object.keys(EXPECTED_PAPERS)) {
    if (excludedIds.has(paperId)) {
      failures.push(
        `paper ${paperId} is expected to be included but is excluded`
      )
    }
  }

  if (loaded.issues.length > 0) {
    for (const issue of loaded.issues) {
      failures.push(
        `${issue.paperId || "batch"} ${issue.code}: ${issue.message}`
      )
    }
  }

  const rows: Array<{
    paperId: string
    actual: ReturnType<typeof countRows>
    expected: ExpectedPaper | undefined
  }> = []

  for (const paper of loaded.papers) {
    const actual = countRows(paper.counts)
    const expected = EXPECTED_PAPERS[paper.manifest.id]
    rows.push({ paperId: paper.manifest.id, actual, expected })
    const manifestCounts = paper.manifest.counts
    failures.push(
      ...comparePaperCounts(paper.manifest.id, actual, expected, {
        high: manifestCounts.bySeverity.high,
        medium: manifestCounts.bySeverity.medium,
        low: manifestCounts.bySeverity.low,
        total:
          manifestCounts.bySeverity.high +
          manifestCounts.bySeverity.medium +
          manifestCounts.bySeverity.low,
        clusters: manifestCounts.clusters,
        agentOnly: manifestCounts.agentOnly,
        auditowlOnly: manifestCounts.auditowlOnly,
        related: manifestCounts.related,
      })
    )
  }

  const anchorStats = await inspectEvidenceAnchors(
    loaded.batch.dir,
    papers.map((paper) =>
      anchorsFromFindings(paper.manifest.id, paper.manifest, paper.dir, [
        { side: "auditowl", findings: paper.auditowlFindings },
        { side: "agent", findings: paper.agentFindings },
      ])
    )
  )
  const localTotal = anchorStats.local + anchorStats.missing
  const localCoverage =
    localTotal === 0 ? 1 : (localTotal - anchorStats.missing) / localTotal
  const totalCoverage =
    anchorStats.total === 0
      ? 1
      : (anchorStats.total - anchorStats.missing) / anchorStats.total

  if (localCoverage < 0.99) {
    failures.push(
      `evidence anchor coverage ${(localCoverage * 100).toFixed(2)}% is below 99%`
    )
  }
  if (anchorStats.missing > 0) {
    failures.push(
      `${anchorStats.missing} evidence anchor(s) could not be resolved`
    )
  }

  console.log("")
  printTable(rows)
  console.log("")
  console.log(
    `items ${loaded.counts.total}: ${loaded.counts.bySeverity.high} high / ` +
      `${loaded.counts.bySeverity.medium} medium / ${loaded.counts.bySeverity.low} low`
  )
  console.log(
    `kinds: ${loaded.counts.clusters} clusters / ${loaded.counts.agentOnly} agent-only / ` +
      `${loaded.counts.auditowlOnly} AuditOwl-only / ${loaded.counts.related} related`
  )
  console.log(
    `excluded: ${loaded.batch.excluded
      .map((entry) => `${entry.paperId} (${entry.reason})`)
      .join(", ")}`
  )
  console.log(
    `findings: ${anchorStats.total} anchors, ${anchorStats.local} local, ` +
      `${anchorStats.url} URL, ${anchorStats.missing} missing`
  )
  console.log(
    `quotes: ${anchorStats.quotes.exact} exact / ${anchorStats.quotes.fuzzy} fuzzy / ` +
      `${anchorStats.quotes.missing} missing / ${anchorStats.quotes.not_checkable} not checkable`
  )
  console.log(
    `local evidence coverage: ${(localCoverage * 100).toFixed(2)}% ` +
      `(${localTotal - anchorStats.missing}/${localTotal})`
  )
  console.log(
    `total evidence coverage: ${(totalCoverage * 100).toFixed(2)}% ` +
      `(${anchorStats.total - anchorStats.missing}/${anchorStats.total})`
  )

  if (anchorStats.urlAnchors.length > 0) {
    console.log("URL anchors (not locally checkable):")
    for (const anchor of anchorStats.urlAnchors) {
      console.log(
        `  ${anchor.paperId} ${anchor.side} ${anchor.id}: ${anchor.file}`
      )
    }
  }
  if (anchorStats.missingAnchors.length > 0) {
    console.log(
      "Unresolved anchors (app/data-contract bug; these fail the check):"
    )
    for (const anchor of anchorStats.missingAnchors) {
      console.log(
        `  ${anchor.paperId} ${anchor.side} ${anchor.id}: ${anchor.file}`
      )
    }
  }
  if (anchorStats.sourceAnomalies.length > 0) {
    console.log(
      `Source anomalies: ${anchorStats.sourceAnomalies.length} quote(s) do not ` +
        "match the cited lines. The source data is not edited; this is not an app bug:"
    )
    for (const anchor of anchorStats.sourceAnomalies) {
      const range =
        anchor.lineStart === null
          ? ""
          : `:${anchor.lineStart}-${anchor.lineEnd ?? anchor.lineStart}`
      console.log(
        `  ${anchor.paperId} ${anchor.side} ${anchor.id}: ${anchor.file}${range}`
      )
    }
  }

  if (failures.length > 0) {
    console.error("")
    console.error(`FAILED: ${failures.length} check(s)`)
    for (const failure of failures) {
      console.error(`  - ${failure}`)
    }
    process.exitCode = 1
    return
  }

  console.log("")
  console.log("OK: review data matches the Phase 1 acceptance criteria")
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
    console.error(
      error instanceof Error ? `review-data:check: ${error.message}` : error
    )
    process.exitCode = 1
  })
}
