import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { batchContentFingerprint, sha256Bytes } from "@/lib/review/hash"
import {
  clearReviewDataCache,
  listBatches,
  loadBatch,
  loadPaper,
  MAX_JSON_FILE_BYTES,
  ReviewDataError,
} from "@/lib/review/load"
import type { Batch, PaperManifest } from "@/lib/review/types"

let root: string

interface FixtureOptions {
  batchId?: string
  paperFile?: string
  generatedAt?: string
}

interface Fixture {
  dir: string
  paperDir: string
  batch: Batch
}

async function writePaperMetadata(
  paperDir: string,
  title: string
): Promise<void> {
  await writeFile(
    path.join(paperDir, "paper.json"),
    JSON.stringify({ title }),
    "utf8"
  )
}

async function createBatch(options: FixtureOptions = {}): Promise<Fixture> {
  const batchId = options.batchId ?? "b1"
  const dir = path.join(root, batchId)
  const paperDir = path.join(dir, "papers", "p1")
  await mkdir(path.join(paperDir, "run"), { recursive: true })
  await mkdir(path.join(paperDir, "auditowl"), { recursive: true })

  const overlap = {
    paper: {
      id: "p1",
      title: "Paper one",
      category: "empirical",
      auditowl_status: "audited",
      comparison_eligible: true,
      scope_note: null,
    },
    matches: [],
    auditowl_only: [],
    agent_only: [],
    related_not_matched: [],
  }
  const overlapText = JSON.stringify(overlap)
  const findingsText = JSON.stringify({ findings: [] })
  await writeFile(path.join(paperDir, "overlap.json"), overlapText, "utf8")
  await writeFile(
    path.join(paperDir, "findings.agent.json"),
    findingsText,
    "utf8"
  )
  await writeFile(
    path.join(paperDir, "findings.auditowl.json"),
    findingsText,
    "utf8"
  )
  await writePaperMetadata(paperDir, "Paper one")
  await writeFile(path.join(paperDir, "paper_text.txt"), "text", "utf8")
  await writeFile(path.join(paperDir, "paper.pdf"), "%PDF-1.4", "utf8")
  await writeFile(path.join(paperDir, "run", "audit.md"), "# agent", "utf8")
  await writeFile(
    path.join(paperDir, "auditowl", "audit.md"),
    "# auditowl",
    "utf8"
  )

  const manifest: PaperManifest = {
    id: "p1",
    title: "Paper one",
    category: "empirical",
    auditowlStatus: "audited",
    comparisonEligible: true,
    scopeNote: null,
    dir: "papers/p1",
    files: {
      overlap: "overlap.json",
      agentFindings: "findings.agent.json",
      auditowlFindings: "findings.auditowl.json",
      paper: options.paperFile ?? "paper.json",
      paperText: "paper_text.txt",
      paperPdf: "paper.pdf",
      agentRun: "run",
      auditowlDir: "auditowl",
    },
    code: [],
    sha256: {
      overlap: sha256Bytes(Buffer.from(overlapText)),
      agentFindings: sha256Bytes(Buffer.from(findingsText)),
      auditowlFindings: sha256Bytes(Buffer.from(findingsText)),
    },
    counts: {
      clusters: 0,
      agentOnly: 0,
      auditowlOnly: 0,
      related: 0,
      bySeverity: { high: 0, medium: 0, low: 0 },
    },
  }

  const base = {
    schemaVersion: 1 as const,
    batchId,
    label: `Batch ${batchId}`,
    generatedAt: options.generatedAt ?? "2026-01-01T00:00:00.000Z",
    protocol: { name: "p", version: "1", path: "p.md" },
    excluded: [],
    papers: [manifest],
  }
  const batch: Batch = {
    ...base,
    contentSha256: batchContentFingerprint(base),
  }
  await writeFile(
    path.join(dir, "batch.json"),
    JSON.stringify(batch, null, 2),
    "utf8"
  )
  return { dir, paperDir, batch }
}

async function expectError(
  action: () => Promise<unknown>,
  code: ReviewDataError["code"]
): Promise<void> {
  try {
    await action()
    throw new Error("expected ReviewDataError")
  } catch (error) {
    expect(error).toBeInstanceOf(ReviewDataError)
    expect((error as ReviewDataError).code).toBe(code)
  }
}

beforeEach(async () => {
  clearReviewDataCache()
  root = await mkdtemp(path.join(tmpdir(), "review-load-"))
})

afterEach(async () => {
  clearReviewDataCache()
  await rm(root, { recursive: true, force: true })
})

describe("listBatches", () => {
  it("loads multiple batches side by side", async () => {
    await createBatch({ batchId: "b1" })
    await createBatch({ batchId: "b2" })
    const summaries = await listBatches({ root })
    expect(summaries.map((summary) => summary.batchId)).toEqual(["b1", "b2"])
    expect(summaries.map((summary) => summary.label)).toEqual([
      "Batch b1",
      "Batch b2",
    ])
  })

  it("reports a batch with an invalid manifest instead of hiding it", async () => {
    await createBatch({ batchId: "b1" })
    await mkdir(path.join(root, "broken"))
    await writeFile(path.join(root, "broken", "batch.json"), "{nope", "utf8")
    const summaries = await listBatches({ root })
    const broken = summaries.find((summary) => summary.batchId === "broken")
    expect(broken?.error).toContain("not valid JSON")
  })
})

describe("loadBatch", () => {
  it("throws BATCH_NOT_FOUND for a missing batch", async () => {
    await expectError(() => loadBatch("missing", { root }), "BATCH_NOT_FOUND")
  })

  it("throws INVALID_JSON for a malformed batch.json", async () => {
    const fixture = await createBatch()
    await writeFile(path.join(fixture.dir, "batch.json"), "{nope", "utf8")
    await expectError(() => loadBatch("b1", { root }), "INVALID_JSON")
  })

  it("derives manifestSha256 from content, not generatedAt", async () => {
    const fixture = await createBatch()
    const first = await loadBatch("b1", { root })
    const changed: Batch = {
      ...fixture.batch,
      generatedAt: "2026-03-03T00:00:00.000Z",
    }
    await writeFile(
      path.join(fixture.dir, "batch.json"),
      JSON.stringify(changed, null, 2),
      "utf8"
    )
    const second = await loadBatch("b1", { root })
    expect(second.manifest.generatedAt).toBe(changed.generatedAt)
    expect(second.manifestSha256).toBe(first.manifestSha256)
  })

  it("works when the review data root is a symlink", async () => {
    await createBatch()
    const alias = path.join(root, "alias")
    await symlink(root, alias)
    const batch = await loadBatch("b1", { root: alias })
    expect(batch.manifest.batchId).toBe("b1")
    expect(batch.papers).toHaveLength(1)
  })

  it("rejects a batch.json symlink that escapes the root", async () => {
    const fixture = await createBatch()
    const outside = path.join(root, "outside-batch.json")
    await writeFile(outside, JSON.stringify(fixture.batch), "utf8")
    await rm(path.join(fixture.dir, "batch.json"))
    await symlink(outside, path.join(fixture.dir, "batch.json"))
    await expectError(() => loadBatch("b1", { root }), "PATH_ESCAPE")
  })
})

describe("loadPaper", () => {
  it("loads a paper and its metadata", async () => {
    await createBatch()
    const paper = await loadPaper("b1", "p1", { root })
    expect(paper.paper.title).toBe("Paper one")
    expect(paper.agentFindings).toEqual([])
  })

  it("throws PAPER_NOT_FOUND for an unknown paper", async () => {
    await createBatch()
    await expectError(() => loadPaper("b1", "p2", { root }), "PAPER_NOT_FOUND")
  })

  it("throws FILE_NOT_FOUND when a paper file is missing", async () => {
    const fixture = await createBatch()
    await rm(path.join(fixture.paperDir, "overlap.json"))
    await expectError(() => loadPaper("b1", "p1", { root }), "FILE_NOT_FOUND")
  })

  it("re-parses the requested schema on every read", async () => {
    await createBatch({ paperFile: "overlap.json" })
    await expectError(() => loadPaper("b1", "p1", { root }), "SCHEMA_INVALID")
  })

  it("rejects a JSON manifest above the size cap", async () => {
    const fixture = await createBatch()
    await truncate(
      path.join(fixture.paperDir, "overlap.json"),
      MAX_JSON_FILE_BYTES + 1
    )
    await expectError(() => loadPaper("b1", "p1", { root }), "FILE_TOO_LARGE")
  })

  it("throws SCHEMA_INVALID for a mismatched files.paper", async () => {
    const fixture = await createBatch()
    await writeFile(
      path.join(fixture.paperDir, "paper.json"),
      JSON.stringify({ authors: [] }),
      "utf8"
    )
    await expectError(() => loadPaper("b1", "p1", { root }), "SCHEMA_INVALID")
  })

  it("invalidates the cache when a file changes", async () => {
    const fixture = await createBatch()
    const first = await loadPaper("b1", "p1", { root })
    expect(first.paper.title).toBe("Paper one")

    await writePaperMetadata(fixture.paperDir, "Paper one, revised")
    const second = await loadPaper("b1", "p1", { root })
    expect(second.paper.title).toBe("Paper one, revised")
  })

  it("rejects a paper.json symlink that escapes the root", async () => {
    const fixture = await createBatch()
    const outside = path.join(root, "outside-paper.json")
    await writeFile(outside, JSON.stringify({ title: "Escaped" }), "utf8")
    await rm(path.join(fixture.paperDir, "paper.json"))
    await symlink(outside, path.join(fixture.paperDir, "paper.json"))
    await expectError(() => loadPaper("b1", "p1", { root }), "PATH_ESCAPE")
  })

  it("rejects a findings symlink that escapes the root", async () => {
    const fixture = await createBatch()
    const outside = path.join(root, "outside-findings.json")
    await writeFile(outside, JSON.stringify({ findings: [] }), "utf8")
    await rm(path.join(fixture.paperDir, "findings.agent.json"))
    await symlink(outside, path.join(fixture.paperDir, "findings.agent.json"))
    await expectError(() => loadPaper("b1", "p1", { root }), "PATH_ESCAPE")
  })
})
