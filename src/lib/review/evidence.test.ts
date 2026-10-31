import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest"

import {
  buildCodePreview,
  buildCsvTable,
  buildEvidenceBundle,
  evidenceRootsFromPaper,
  excerptAroundLine,
  findQuoteContexts,
  isBinaryPath,
  isIgnoredEntry,
  isIgnoredRelativePath,
  listTree,
  MAX_CSV_ROWS,
  parseCsv,
  parsePaperPages,
  resolvePaperFilePath,
  runRipgrep,
  sanitizeAttempts,
  searchCode,
  searchPaperText,
} from "@/lib/review/evidence"
import { joinWithin } from "@/lib/review/paths"
import { loadItems } from "@/lib/review/load"
import type { PaperManifest } from "@/lib/review/types"

describe("parseCsv", () => {
  it("parses quoted fields, escaped quotes and CRLF rows", () => {
    expect(parseCsv('a,b\r\n"x,y","he said ""hi"""\r\n1,2\r\n')).toEqual([
      ["a", "b"],
      ["x,y", 'he said "hi"'],
      ["1", "2"],
    ])
  })

  it("keeps embedded newlines inside quoted fields", () => {
    expect(parseCsv('id,note\n1,"line one\nline two"\n')).toEqual([
      ["id", "note"],
      ["1", "line one\nline two"],
    ])
  })

  it("strips a BOM and handles a missing trailing newline", () => {
    expect(parseCsv("\uFEFFa,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ])
  })

  it("returns no rows for empty input", () => {
    expect(parseCsv("")).toEqual([])
  })
})

describe("buildCsvTable", () => {
  const csv = [
    "check,reference,result",
    "1,train.py:10-14,hit",
    "2,evaluate.py:5-7,hit",
    "3,other.py:1,miss",
  ].join("\n")

  it("highlights rows whose reference matches the finding file and lines", () => {
    const table = buildCsvTable(csv, {
      file: "code/fixturerepo/train.py",
      lineStart: 12,
      lineEnd: 12,
    })
    expect(table.columns).toEqual(["check", "reference", "result"])
    expect(table.totalRows).toBe(3)
    expect(table.rows.filter((row) => row.highlight)).toHaveLength(1)
    expect(table.rows[0].highlight).toBe(true)
  })

  it("caps displayed rows", () => {
    const rows = ["reference"]
    for (let index = 0; index < MAX_CSV_ROWS + 5; index += 1) {
      rows.push(`file.py:${index + 1}`)
    }
    const table = buildCsvTable(rows.join("\n"), {
      file: "file.py",
      lineStart: null,
      lineEnd: null,
    })
    expect(table.rows).toHaveLength(MAX_CSV_ROWS)
    expect(table.totalRows).toBe(MAX_CSV_ROWS + 5)
    expect(table.truncated).toBe(true)
  })
})

describe("parsePaperPages", () => {
  it("parses single pages and ranges", () => {
    expect(parsePaperPages("p. 8, pp. 21-22")).toEqual([8, 21, 22])
    expect(parsePaperPages("Page 3 and pages 6–7")).toEqual([3, 6, 7])
    expect(parsePaperPages("see Section 4")).toEqual([])
    expect(parsePaperPages(null)).toEqual([])
  })

  it("does not expand absurd ranges", () => {
    expect(parsePaperPages("pp. 1-500")).toEqual([1, 500])
  })
})

describe("findQuoteContexts", () => {
  const text =
    "Intro\n\f2 Method\nWe select augmentations on the test split and keep the best augmentation.\n\f3 Results\nMore text."

  it("finds the quote and reports the PDF page", () => {
    const contexts = findQuoteContexts(text, "test split and keep", {
      radius: 20,
      maxContexts: 2,
    })
    expect(contexts).toHaveLength(1)
    expect(contexts[0].page).toBe(2)
    expect(contexts[0].snippet).toContain("test split")
  })

  it("returns nothing for an empty quote", () => {
    expect(findQuoteContexts(text, "")).toEqual([])
    expect(findQuoteContexts(text, null)).toEqual([])
  })
})

describe("searchPaperText", () => {
  const text = "Alpha beta\n\fSecond page alpha ALPHA"

  it("searches case-insensitively with line and page numbers", () => {
    const { results } = searchPaperText(text, "alpha", 10)
    expect(results).toHaveLength(3)
    expect(results[0].line).toBe(1)
    expect(results[0].page).toBe(1)
    expect(results[1].page).toBe(2)
  })

  it("caps results and reports truncation", () => {
    const { results, truncated } = searchPaperText("aa aa aa", "aa", 2)
    expect(results).toHaveLength(2)
    expect(truncated).toBe(true)
  })
})

describe("excerptAroundLine", () => {
  const text = Array.from(
    { length: 200 },
    (_, index) => `line ${index + 1}`
  ).join("\n")

  it("centres the excerpt on the audit line", () => {
    const excerpt = excerptAroundLine(text, 100, 40)
    expect(excerpt.startLine).toBe(60)
    expect(excerpt.endLine).toBe(140)
    expect(excerpt.truncated).toBe(true)
    expect(excerpt.excerpt).toContain("line 100")
  })

  it("clamps a line beyond the file", () => {
    const excerpt = excerptAroundLine(text, 1000, 2)
    expect(excerpt.endLine).toBe(200)
    expect(excerpt.excerpt).toContain("line 200")
  })

  it("handles an empty report", () => {
    expect(excerptAroundLine("", 3, 5).totalLines).toBe(0)
  })
})

describe("buildCodePreview", () => {
  const text = Array.from(
    { length: 120 },
    (_, index) => `code ${index + 1}`
  ).join("\n")

  it("adds context lines and marks the cited range", () => {
    const preview = buildCodePreview(text, 50, 52, { context: 2 })
    expect(preview.startLine).toBe(48)
    expect(preview.endLine).toBe(54)
    expect(preview.lines.filter((line) => line.cited)).toHaveLength(3)
    expect(preview.truncated).toBe(false)
  })

  it("caps very long windows", () => {
    const preview = buildCodePreview(text, 10, 110, {
      context: 40,
      maxLines: 40,
    })
    expect(preview.lines).toHaveLength(40)
    expect(preview.truncated).toBe(true)
  })

  it("shows the beginning when no line is cited", () => {
    const preview = buildCodePreview("a\nb\nc", null, null, { context: 2 })
    expect(preview.startLine).toBe(1)
    expect(preview.lines).toHaveLength(3)
  })

  it("never marks a line past EOF as cited", () => {
    const preview = buildCodePreview("a\nb\nc", 20, 22, { context: 2 })
    expect(preview.totalLines).toBe(3)
    expect(preview.lines.some((line) => line.cited)).toBe(false)
  })

  it("caps a pathological single line", () => {
    const preview = buildCodePreview("x".repeat(5000), 1, 1, {
      maxLineChars: 100,
    })
    expect(preview.lines).toHaveLength(1)
    expect(preview.lines[0].text).toHaveLength(101)
    expect(preview.lines[0].text.endsWith("…")).toBe(true)
  })

  it("reports a truncated source", () => {
    const preview = buildCodePreview("a\nb", 1, 1, { sourceTruncated: true })
    expect(preview.truncated).toBe(true)
  })
})

describe("sanitizeAttempts", () => {
  it("keeps paper-relative paths and hides absolute paths", () => {
    const attempts = sanitizeAttempts(
      [
        {
          step: "paper-dir",
          path: "/tmp/paper/code/a.py",
          outcome: "miss",
        },
        { step: "reject", path: "/etc/passwd", outcome: "skip" },
      ],
      "/tmp/paper"
    )
    expect(attempts[0].path).toBe("code/a.py")
    expect(attempts[1].path).toBe("<outside the paper directory>")
  })
})

describe("isBinaryPath", () => {
  it("flags common binary extensions", () => {
    expect(isBinaryPath("model.sif")).toBe(true)
    expect(isBinaryPath("run.pyc")).toBe(true)
    expect(isBinaryPath("train.py")).toBe(false)
  })
})

describe("ignored evidence paths", () => {
  it("blocks VCS, dependency and transient entries", () => {
    for (const name of [
      ".git",
      "node_modules",
      "__pycache__",
      ".venv",
      "cache.pyc",
      "image.sif",
      "trajectory.json",
      ".env",
      ".env.local",
      ".DS_Store",
    ]) {
      expect(isIgnoredEntry(name)).toBe(true)
    }
    expect(isIgnoredEntry("train.py")).toBe(false)
    expect(isIgnoredRelativePath("code/repo/.git/config")).toBe(true)
    expect(isIgnoredRelativePath("code/repo/node_modules/pkg/index.js")).toBe(
      true
    )
    expect(isIgnoredRelativePath("code/repo/train.py")).toBe(false)
  })
})

describe("resolvePaperFilePath", () => {
  let root: string
  let batch: string
  let paper: string

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "evidence-path-"))
    batch = path.join(root, "batch")
    paper = path.join(batch, "papers", "p1")
    await mkdir(paper, { recursive: true })
    await mkdir(path.join(paper, "code"), { recursive: true })
    await writeFile(path.join(paper, "paper.pdf"), "%PDF-1.4")
    await writeFile(path.join(paper, "code", "train.py"), "print('hi')\n")
    await writeFile(path.join(root, "secret.txt"), "secret")
    await symlink(path.join(root, "secret.txt"), path.join(paper, "escape.txt"))
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it("resolves a file inside the paper directory", async () => {
    const resolved = await resolvePaperFilePath(paper, batch, "paper.pdf")
    expect(resolved?.relativePath).toBe("paper.pdf")
    expect(resolved?.size).toBeGreaterThan(0)
  })

  it("rejects traversal and absolute paths", async () => {
    expect(await resolvePaperFilePath(paper, batch, "../batch.json")).toBeNull()
    expect(await resolvePaperFilePath(paper, batch, "/etc/passwd")).toBeNull()
    expect(
      await resolvePaperFilePath(paper, batch, "code/../../secret.txt")
    ).toBeNull()
  })

  it("rejects symlinks that leave the batch", async () => {
    expect(await resolvePaperFilePath(paper, batch, "escape.txt")).toBeNull()
  })

  it("rejects directories and missing files", async () => {
    expect(await resolvePaperFilePath(paper, batch, "code")).toBeNull()
    expect(await resolvePaperFilePath(paper, batch, "missing.txt")).toBeNull()
  })
})

describe("evidence bundle from the committed fixture", () => {
  const root = path.join(process.cwd(), "e2e", "fixtures", "review-data")
  const batchId = "review-fixture"

  it("builds code, check, paper and report evidence", async () => {
    const loaded = await loadItems(batchId, { root })
    expect(loaded.counts.total).toBe(11)
    expect(loaded.counts.bySeverity).toEqual({ high: 2, medium: 2, low: 7 })

    const item = loaded.items.find(
      (candidate) => candidate.kind === "cluster" && candidate.ref === "M01"
    )
    expect(item).toBeDefined()
    if (!item) {
      return
    }
    const paper = loaded.papers[0]
    const paperDir = joinWithin(loaded.batch.dir, paper.manifest.dir)
    expect(paperDir).not.toBeNull()
    if (!paperDir) {
      return
    }

    const bundle = await buildEvidenceBundle({
      batchId,
      paperId: "1001",
      item,
      roots: evidenceRootsFromPaper(loaded.batch.dir, {
        manifest: paper.manifest,
        dir: paperDir,
      }),
    })

    expect(bundle.health.codeTotal).toBe(2)
    expect(bundle.health.codeResolved).toBe(2)
    expect(bundle.health.quoteExact).toBe(2)
    expect(bundle.health.checksResolved).toBe(bundle.health.checksTotal)
    expect(bundle.health.reportsAvailable).toBe(2)

    const agent = bundle.sides.find((side) => side.side === "agent")
    expect(agent).toBeDefined()
    const finding = agent?.findings[0]
    expect(finding?.code.kind).toBe("file")
    expect(finding?.code.quoteMatch).toBe("exact")
    expect(finding?.code.preview?.lines.some((line) => line.cited)).toBe(true)
    expect(finding?.paper.pages).toEqual([2])
    expect(finding?.paper.pdfAvailable).toBe(true)
    expect(finding?.report.available).toBe(true)
    expect(finding?.report.excerpt).toContain("Finding a1")

    const csv = finding?.checks.find((check) => check.format === "csv")
    expect(csv?.resolved).toBe(true)
    expect(csv?.csv?.rows.some((row) => row.highlight)).toBe(true)
    expect(csv?.csv?.truncated).toBe(true)
    expect(csv?.truncated).toBe(true)
  })

  it("flags extracted paper text larger than 8 MB", async () => {
    const loaded = await loadItems(batchId, { root })
    const item = loaded.items.find(
      (candidate) => candidate.kind === "cluster" && candidate.ref === "M01"
    )
    const paper = loaded.papers[0]
    const paperDir = joinWithin(loaded.batch.dir, paper.manifest.dir)
    expect(item).toBeDefined()
    expect(paperDir).not.toBeNull()
    if (!item || !paperDir) {
      return
    }
    const bigText = path.join(paperDir, "paper_text_big.txt")
    await writeFile(bigText, "a".repeat(8 * 1024 * 1024 + 32), "utf8")
    try {
      const roots = evidenceRootsFromPaper(loaded.batch.dir, {
        manifest: paper.manifest,
        dir: paperDir,
      })
      roots.paperTextPath = bigText
      const bundle = await buildEvidenceBundle({
        batchId,
        paperId: "1001",
        item,
        roots,
      })
      const evidence = bundle.sides[0].findings[0].paper
      expect(evidence.paperTextAvailable).toBe(true)
      expect(evidence.paperTextTruncated).toBe(true)
    } finally {
      await rm(bigText, { force: true })
    }
  })

  it("marks a missing anchor and sanitises its attempts", async () => {
    const loaded = await loadItems(batchId, { root })
    const item = loaded.items.find(
      (candidate) => candidate.kind === "agent_only" && candidate.ref === "a2"
    )
    const paper = loaded.papers[0]
    const paperDir = joinWithin(loaded.batch.dir, paper.manifest.dir)
    expect(item).toBeDefined()
    expect(paperDir).not.toBeNull()
    if (!item || !paperDir) {
      return
    }

    const broken = {
      ...item,
      findings: {
        ...item.findings,
        agent: item.findings.agent.map((finding) => ({
          ...finding,
          file: "code/fixturerepo/not-there.py",
        })),
      },
    }
    const bundle = await buildEvidenceBundle({
      batchId,
      paperId: "1001",
      item: broken,
      roots: evidenceRootsFromPaper(loaded.batch.dir, {
        manifest: paper.manifest,
        dir: paperDir,
      }),
    })
    const code = bundle.sides[0].findings[0].code
    expect(code.kind).toBe("missing")
    expect(code.missingAttempts.length).toBeGreaterThan(0)
    expect(
      code.missingAttempts.every((attempt) => !attempt.path.startsWith("/"))
    ).toBe(true)
    expect(code.closestMatches.length).toBeGreaterThan(0)
    expect(
      code.closestMatches.every(
        (match) =>
          !match.path.startsWith("/") && match.url.startsWith("/api/evidence/")
      )
    ).toBe(true)
    expect(bundle.health.codeMissing).toBe(1)
  })

  it("labels external check URLs as URL artifacts", async () => {
    const loaded = await loadItems(batchId, { root })
    const item = loaded.items.find(
      (candidate) => candidate.kind === "agent_only" && candidate.ref === "a2"
    )
    const paper = loaded.papers[0]
    const paperDir = joinWithin(loaded.batch.dir, paper.manifest.dir)
    if (!item || !paperDir) {
      return
    }
    const withUrl = {
      ...item,
      findings: {
        ...item.findings,
        agent: item.findings.agent.map((finding) => ({
          ...finding,
          checkScript: "https://example.org/artifact.csv",
          verification: null,
        })),
      },
    }
    const bundle = await buildEvidenceBundle({
      batchId,
      paperId: "1001",
      item: withUrl,
      roots: evidenceRootsFromPaper(loaded.batch.dir, {
        manifest: paper.manifest,
        dir: paperDir,
      }),
    })
    const check = bundle.sides[0].findings[0].checks[0]
    expect(check.format).toBe("url")
    expect(check.resolved).toBe(false)
    expect(check.url).toBe("https://example.org/artifact.csv")
  })

  it("lists the tree without ignored or hidden directories", async () => {
    const loaded = await loadItems(batchId, { root })
    const paper = loaded.papers[0]
    const paperDir = joinWithin(loaded.batch.dir, paper.manifest.dir)
    expect(paperDir).not.toBeNull()
    if (!paperDir) {
      return
    }
    const tree = await listTree({
      paper: { manifest: paper.manifest, dir: paperDir },
      scope: "paper",
    })
    expect(tree.entries.some((entry) => entry.path === "paper.pdf")).toBe(true)
    expect(tree.entries.some((entry) => entry.path.startsWith("code/"))).toBe(
      false
    )

    const codeTree = await listTree({
      paper: { manifest: paper.manifest, dir: paperDir },
      scope: "code",
    })
    expect(
      codeTree.entries.some(
        (entry) =>
          entry.path === "code/fixturerepo" && entry.type === "directory"
      )
    ).toBe(true)
    expect(
      codeTree.entries.some(
        (entry) =>
          entry.path === "code/fixturerepo/train.py" &&
          entry.type === "file" &&
          !entry.binary
      )
    ).toBe(true)

    const runTree = await listTree({
      paper: { manifest: paper.manifest, dir: paperDir },
      scope: "run",
    })
    expect(runTree.entries.some((entry) => entry.path === "run/audit.md")).toBe(
      true
    )
  })

  it("does not follow a symlinked code root out of the paper", async () => {
    const loaded = await loadItems(batchId, { root })
    const workspace = await mkdtemp(path.join(tmpdir(), "tree-root-"))
    try {
      const outside = path.join(workspace, "outside")
      const paperDir = path.join(workspace, "paper")
      await mkdir(outside, { recursive: true })
      await mkdir(path.join(paperDir, "code"), { recursive: true })
      await writeFile(path.join(outside, "secret.txt"), "secret\n")
      await symlink(outside, path.join(paperDir, "code", "repo"))
      const tree = await listTree({
        paper: {
          manifest: {
            ...loaded.papers[0].manifest,
            code: [
              {
                name: "repo",
                dir: "code/repo",
                role: "repository",
                commit: null,
              },
            ],
          },
          dir: paperDir,
        },
        scope: "code",
      })
      expect(tree.entries).toEqual([])
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})

describe("ripgrep search", () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "evidence-search-"))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it("treats user queries as fixed strings", async () => {
    await writeFile(
      path.join(directory, "sample.txt"),
      "a.b\naXb\na*b\n",
      "utf8"
    )
    const run = await runRipgrep(directory, "a.b")
    expect(run.unavailable).toBe(false)
    expect(
      run.lines.filter((line) => line.includes('"type":"match"'))
    ).toHaveLength(1)
  })

  it("accepts queries that start with a dash", async () => {
    await writeFile(
      path.join(directory, "flags.txt"),
      "--flag=1\nplain\n",
      "utf8"
    )
    const run = await runRipgrep(directory, "--flag")
    expect(
      run.lines.filter((line) => line.includes('"type":"match"'))
    ).toHaveLength(1)
  })

  it("reports a missing binary as unavailable", async () => {
    const emptyBin = path.join(directory, "empty-bin")
    await mkdir(emptyBin, { recursive: true })
    const previousPath = process.env.PATH
    process.env.PATH = emptyBin
    try {
      const run = await runRipgrep(directory, "x")
      expect(run.unavailable).toBe(true)
    } finally {
      process.env.PATH = previousPath
    }
  })

  it("reports a timeout and capped output", async () => {
    await writeFile(
      path.join(directory, "large.txt"),
      "needle\n".repeat(5000),
      "utf8"
    )
    const timedOut = await runRipgrep(directory, "needle", { timeoutMs: 0 })
    expect(timedOut.timedOut).toBe(true)

    const capped = await runRipgrep(directory, "needle", {
      maxOutputBytes: 128,
    })
    expect(capped.outputCapped).toBe(true)
  })

  it("surfaces a missing ripgrep as unavailable", async () => {
    const root = path.join(process.cwd(), "e2e", "fixtures", "review-data")
    const loaded = await loadItems("review-fixture", { root })
    const paper = loaded.papers[0]
    const paperDir = joinWithin(loaded.batch.dir, paper.manifest.dir)
    expect(paperDir).not.toBeNull()
    if (!paperDir) {
      return
    }
    const emptyBin = path.join(directory, "empty-bin")
    await mkdir(emptyBin, { recursive: true })
    const previousPath = process.env.PATH
    process.env.PATH = emptyBin
    try {
      const outcome = await searchCode(
        { manifest: paper.manifest, dir: paperDir },
        "review-fixture",
        "seed"
      )
      expect(outcome.unavailable).toBe(true)
    } finally {
      process.env.PATH = previousPath
    }
  })

  it("ignores a repo root that is a symlink outside the paper", async () => {
    const loaded = await loadItems("review-fixture", {
      root: path.join(process.cwd(), "e2e", "fixtures", "review-data"),
    })
    const paperDir = path.join(directory, "paper")
    const outside = path.join(directory, "outside")
    await mkdir(path.join(paperDir, "code"), { recursive: true })
    await mkdir(outside, { recursive: true })
    await writeFile(
      path.join(outside, "secret.txt"),
      "unique-leak-token\n",
      "utf8"
    )
    await symlink(outside, path.join(paperDir, "code", "repo"))
    const manifest: PaperManifest = {
      ...loaded.papers[0].manifest,
      code: [
        {
          name: "repo",
          dir: "code/repo",
          role: "repository",
          commit: null,
        },
      ],
    }
    const outcome = await searchCode(
      { manifest, dir: paperDir },
      "review-fixture",
      "unique-leak-token"
    )
    expect(outcome.unavailable).toBe(false)
    expect(outcome.results).toEqual([])
  })

  it("caps search results per repository", async () => {
    const root = path.join(process.cwd(), "e2e", "fixtures", "review-data")
    const loaded = await loadItems("review-fixture", { root })
    const paper = loaded.papers[0]
    const paperDir = joinWithin(loaded.batch.dir, paper.manifest.dir)
    expect(paperDir).not.toBeNull()
    if (!paperDir) {
      return
    }
    const file = path.join(paperDir, "code", "fixturerepo", "cap-search.txt")
    await writeFile(file, "unique-cap-token\n".repeat(30), "utf8")
    try {
      const outcome = await searchCode(
        { manifest: paper.manifest, dir: paperDir },
        "review-fixture",
        "unique-cap-token"
      )
      expect(outcome.unavailable).toBe(false)
      expect(outcome.results).toHaveLength(20)
      expect(outcome.truncated).toBe(true)
    } finally {
      await rm(file, { force: true })
    }
  })
})
