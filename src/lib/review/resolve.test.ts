import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  compareQuote,
  MAX_QUOTE_READ_BYTES,
  normalizeForMatch,
  normalizeQuote,
  resolveEvidence,
  type ResolveRoots,
} from "@/lib/review/resolve"

let workspace: string
let batchRoot: string
let paperDir: string
let repoDir: string
let runDir: string
let auditowlDir: string
let roots: ResolveRoots

async function writeFileAt(relative: string, content: string): Promise<string> {
  const target = path.join(batchRoot, relative)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, content, "utf8")
  return target
}

beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "review-resolve-"))
  batchRoot = path.join(workspace, "batch")
  paperDir = path.join(batchRoot, "papers", "p1")
  repoDir = path.join(paperDir, "code", "owner__repo")
  runDir = path.join(paperDir, "run")
  auditowlDir = path.join(paperDir, "auditowl")
  await mkdir(repoDir, { recursive: true })
  await mkdir(runDir, { recursive: true })
  await mkdir(auditowlDir, { recursive: true })
  roots = {
    batchRoot,
    paperDir,
    repos: [{ name: "owner__repo", dir: repoDir }],
    runDir,
    auditowlDir,
  }
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

describe("resolveEvidence", () => {
  it("resolves a paper file", async () => {
    await writeFileAt("papers/p1/paper.pdf", "%PDF-1.4")
    const result = await resolveEvidence({
      roots,
      side: "agent",
      finding: { file: "paper.pdf" },
    })
    expect(result.kind).toBe("paper")
    expect(result.absolutePath).toBe(path.join(paperDir, "paper.pdf"))
  })

  it("resolves repo-relative paths", async () => {
    await writeFileAt("papers/p1/code/owner__repo/model/model.py", "x = 1\n")
    const result = await resolveEvidence({
      roots,
      side: "agent",
      finding: { file: "model/model.py", lineStart: 1, lineEnd: 1 },
    })
    expect(result.kind).toBe("file")
    expect(result.absolutePath).toBe(path.join(repoDir, "model", "model.py"))
  })

  it("resolves workspace-relative code paths", async () => {
    await writeFileAt("papers/p1/code/owner__repo/README.md", "# Readme\n")
    const result = await resolveEvidence({
      roots,
      side: "agent",
      finding: { file: "code/owner__repo/README.md" },
    })
    expect(result.kind).toBe("file")
    expect(result.absolutePath).toBe(path.join(repoDir, "README.md"))
  })

  it("resolves repo-prefixed paths", async () => {
    await writeFileAt("papers/p1/code/owner__repo/train.py", "print(1)\n")
    const result = await resolveEvidence({
      roots,
      side: "agent",
      finding: { file: "owner__repo/train.py" },
    })
    expect(result.absolutePath).toBe(path.join(repoDir, "train.py"))
  })

  it("searches run arm work trees for out/ artifacts", async () => {
    const target = await writeFileAt(
      "papers/p1/run/audit/work/_audit_code/out/check_missing.csv",
      "a,b\n1,2\n"
    )
    const result = await resolveEvidence({
      roots,
      side: "agent",
      finding: { file: "out/check_missing.csv" },
    })
    expect(result.kind).toBe("check")
    expect(result.absolutePath).toBe(target)
  })

  it("searches run arm work trees for _audit_code scripts", async () => {
    const target = await writeFileAt(
      "papers/p1/run/audit/work/_audit_code/check.py",
      "print('check')\n"
    )
    const result = await resolveEvidence({
      roots,
      side: "agent",
      finding: { file: "_audit_code/check.py" },
    })
    expect(result.kind).toBe("check")
    expect(result.absolutePath).toBe(target)
  })

  it("searches the AuditOwl tree for check output", async () => {
    const target = await writeFileAt(
      "papers/p1/auditowl/_audit_code/out/report.txt",
      "ok\n"
    )
    const result = await resolveEvidence({
      roots,
      side: "auditowl",
      finding: { file: "out/report.txt" },
    })
    expect(result.kind).toBe("check")
    expect(result.absolutePath).toBe(target)
  })

  it("falls back to a unique basename", async () => {
    const target = await writeFileAt(
      "papers/p1/code/owner__repo/deep/nested/special.py",
      "x = 1\n"
    )
    const result = await resolveEvidence({
      roots,
      side: "agent",
      finding: { file: "special.py" },
    })
    expect(result.absolutePath).toBe(target)
  })

  it("refuses traversal outside the batch root", async () => {
    await writeFileAt("outside.txt", "secret\n")
    const result = await resolveEvidence({
      roots,
      side: "agent",
      finding: { file: "../../../outside.txt" },
    })
    expect(result.kind).toBe("missing")
    expect(result.absolutePath).toBeNull()
    expect(result.attempts.some((attempt) => attempt.outcome === "skip")).toBe(
      true
    )
  })

  it("resolves audit/work paths on the agent side", async () => {
    const target = await writeFileAt(
      "papers/p1/run/audit/work/_audit_code/out/report.csv",
      "a,b\n"
    )
    const result = await resolveEvidence({
      roots,
      side: "agent",
      finding: { file: "audit/work/_audit_code/out/report.csv" },
    })
    expect(result.kind).toBe("check")
    expect(result.absolutePath).toBe(target)
  })

  it("resolves audit/work paths on the AuditOwl side", async () => {
    const target = await writeFileAt(
      "papers/p1/auditowl/_audit_code/out/report.csv",
      "a,b\n"
    )
    const result = await resolveEvidence({
      roots,
      side: "auditowl",
      finding: { file: "audit/work/_audit_code/out/report.csv" },
    })
    expect(result.kind).toBe("check")
    expect(result.absolutePath).toBe(target)
  })

  it("resolves audit2/work out paths", async () => {
    const target = await writeFileAt(
      "papers/p1/run/audit2/work/_audit_code/out/check.csv",
      "a,b\n"
    )
    const result = await resolveEvidence({
      roots,
      side: "agent",
      finding: { file: "audit2/work/out/check.csv" },
    })
    expect(result.absolutePath).toBe(target)
  })

  it("resolves _verifier_code paths inside arm work trees", async () => {
    const target = await writeFileAt(
      "papers/p1/run/audit/work/_verifier_code/out/verify.txt",
      "ok\n"
    )
    const result = await resolveEvidence({
      roots,
      side: "agent",
      finding: { file: "audit/work/_verifier_code/out/verify.txt" },
    })
    expect(result.kind).toBe("check")
    expect(result.absolutePath).toBe(target)
  })

  it("rejects absolute paths without falling back to a basename", async () => {
    await writeFileAt("papers/p1/code/owner__repo/secret.py", "secret\n")
    const result = await resolveEvidence({
      roots,
      side: "agent",
      finding: { file: "/secret.py" },
    })
    expect(result.kind).toBe("missing")
    expect(result.attempts.map((attempt) => attempt.step)).not.toContain(
      "unique-basename"
    )
  })

  it("rejects traversal without falling back to a basename", async () => {
    await writeFileAt("papers/p1/code/owner__repo/secret.py", "secret\n")
    const result = await resolveEvidence({
      roots,
      side: "agent",
      finding: { file: "../secret.py" },
    })
    expect(result.kind).toBe("missing")
    expect(result.attempts.map((attempt) => attempt.step)).not.toContain(
      "unique-basename"
    )
  })

  it("does not use an ambiguous basename", async () => {
    await writeFileAt("papers/p1/code/owner__repo/a/special.py", "x = 1\n")
    await writeFileAt("papers/p1/code/owner__repo/b/special.py", "x = 2\n")
    const result = await resolveEvidence({
      roots,
      side: "agent",
      finding: { file: "special.py" },
    })
    expect(result.kind).toBe("missing")
    expect(
      result.attempts.find((attempt) => attempt.step === "unique-basename")
        ?.note
    ).toContain("not unique")
  })

  it("refuses symlinks that escape the batch root", async () => {
    const outside = path.join(workspace, "outside.py")
    await writeFile(outside, "secret\n", "utf8")
    await symlink(outside, path.join(repoDir, "escape.py"))
    const result = await resolveEvidence({
      roots,
      side: "agent",
      finding: { file: "escape.py" },
    })
    expect(result.kind).toBe("missing")
  })

  it("rejects a symlink that points into another paper", async () => {
    const otherPaperFile = await writeFileAt(
      "papers/p2/code/owner__repo/secret.py",
      "secret\n"
    )
    await symlink(otherPaperFile, path.join(repoDir, "leak.py"))
    const result = await resolveEvidence({
      roots,
      side: "agent",
      finding: { file: "leak.py", lineStart: 1, lineEnd: 1, quote: "secret" },
    })
    expect(result.kind).toBe("missing")
    expect(result.absolutePath).toBeNull()
  })

  it("rejects a symlink that points at an ignored path", async () => {
    const ignored = await writeFileAt(
      "papers/p1/code/owner__repo/.git/config",
      "[core]\n"
    )
    await symlink(ignored, path.join(repoDir, "leak-ignored.py"))
    const result = await resolveEvidence({
      roots,
      side: "agent",
      finding: {
        file: "leak-ignored.py",
        lineStart: 1,
        lineEnd: 1,
        quote: "[core]",
      },
    })
    expect(result.kind).toBe("missing")
  })

  it("rejects a requested ignored path", async () => {
    await writeFileAt("papers/p1/code/owner__repo/.git/config", "[core]\n")
    const result = await resolveEvidence({
      roots,
      side: "agent",
      finding: { file: ".git/config", lineStart: 1, lineEnd: 1 },
    })
    expect(result.kind).toBe("missing")
    expect(
      result.attempts.some(
        (attempt) => attempt.note === "ignored evidence path"
      )
    ).toBe(true)
  })

  it("ignores a repo root that is a symlink into another paper", async () => {
    await writeFileAt("papers/p2/code/owner__repo/secret.py", "secret\n")
    const alias = path.join(paperDir, "code", "alias")
    await symlink(path.join(batchRoot, "papers", "p2"), alias)
    const result = await resolveEvidence({
      roots: {
        ...roots,
        repos: [{ name: "alias", dir: alias }],
      },
      side: "agent",
      finding: { file: "secret.py", lineStart: 1, lineEnd: 1 },
    })
    expect(result.kind).toBe("missing")
  })

  it("returns a url result without touching the filesystem", async () => {
    const result = await resolveEvidence({
      roots,
      side: "agent",
      finding: { file: "https://example.org/data.csv" },
    })
    expect(result.kind).toBe("url")
    expect(result.url).toBe("https://example.org/data.csv")
    expect(result.quoteMatch).toBe("not_checkable")
  })
})

describe("quote normalization", () => {
  it("strips common indentation and blank edges", () => {
    const text = "\n    def train():\n        return 1\n\n"
    expect(normalizeQuote(text)).toBe("def train():\n    return 1")
    expect(normalizeForMatch(text)).toBe("def train(): return 1")
  })

  it("matches exact quotes after indentation changes", async () => {
    const target = await writeFileAt(
      "papers/p1/code/owner__repo/source.py",
      "def train():\n    return 1\n"
    )
    const result = await resolveEvidence({
      roots,
      side: "agent",
      finding: {
        file: "source.py",
        lineStart: 1,
        lineEnd: 2,
        quote: "    def train():\n        return 1",
      },
    })
    expect(result.absolutePath).toBe(target)
    expect(result.quoteMatch).toBe("exact")
  })

  it("reports a fuzzy quote when punctuation differs", () => {
    expect(
      compareQuote(
        "def train(model,data): return model(data)",
        "def train(model, data):\n    return model(data)"
      )
    ).toBe("fuzzy")
  })

  it("reports a missing quote for unrelated text", () => {
    expect(compareQuote("alpha beta gamma", "totally different words")).toBe(
      "missing"
    )
  })

  it("reports quotes without a line range as not checkable", async () => {
    await writeFileAt("papers/p1/code/owner__repo/none.py", "x = 1\n")
    const result = await resolveEvidence({
      roots,
      side: "agent",
      finding: { file: "none.py", quote: "x = 1" },
    })
    expect(result.kind).toBe("file")
    expect(result.quoteMatch).toBe("not_checkable")
  })

  it("does not read a huge one-line file to verify a quote", async () => {
    const big = path.join(repoDir, "plots.ipynb")
    await writeFile(big, "x".repeat(2 * 1024 * 1024), "utf8")
    const result = await resolveEvidence({
      roots,
      side: "agent",
      finding: {
        file: "plots.ipynb",
        lineStart: 1,
        lineEnd: 1,
        quote: "x",
      },
    })
    expect(result.quoteMatch).toBe("not_checkable")
  })

  it("checks a small file cited past line 400", async () => {
    const lines = Array.from(
      { length: 410 },
      (_, index) => `line ${index + 1}`
    ).join("\n")
    await writeFileAt("papers/p1/code/owner__repo/long.py", lines)
    const result = await resolveEvidence({
      roots,
      side: "agent",
      finding: {
        file: "long.py",
        lineStart: 405,
        lineEnd: 405,
        quote: "line 405",
      },
    })
    expect(result.quoteMatch).toBe("exact")
  })

  it("reports a citation beyond the 1 MB read window with a reason", async () => {
    const line = `${"x".repeat(99)}\n`
    const content = line.repeat(
      Math.ceil((MAX_QUOTE_READ_BYTES * 1.1) / line.length) + 10
    )
    await writeFileAt("papers/p1/code/owner__repo/huge.py", content)
    const result = await resolveEvidence({
      roots,
      side: "agent",
      finding: {
        file: "huge.py",
        lineStart: 100_000,
        lineEnd: 100_000,
        quote: "x",
      },
    })
    expect(result.quoteMatch).toBe("not_checkable")
    expect(result.note).toContain("beyond the first")
    expect(result.note).toContain(String(MAX_QUOTE_READ_BYTES))
  })

  it("reports a small-file line past EOF as missing", async () => {
    await writeFileAt("papers/p1/code/owner__repo/short.py", "a\nb\n")
    const result = await resolveEvidence({
      roots,
      side: "agent",
      finding: { file: "short.py", lineStart: 50, lineEnd: 50, quote: "a" },
    })
    expect(result.quoteMatch).toBe("missing")
  })
})
