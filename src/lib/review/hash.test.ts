import { describe, expect, it } from "vitest"

import {
  batchContentFingerprint,
  canonicalJson,
  itemHash,
} from "@/lib/review/hash"
import type { Batch } from "@/lib/review/types"

function batch(generatedAt: string): Batch {
  return {
    schemaVersion: 1,
    batchId: "b1",
    label: "Test batch",
    generatedAt,
    contentSha256: "0".repeat(64),
    protocol: { name: "p", version: "1", path: "p.md" },
    excluded: [],
    papers: [],
  }
}

describe("canonical json", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3] } })).toBe(
      '{"a":{"c":[3],"d":2},"b":1}'
    )
  })

  it("hashes equal values identically and changed values differently", () => {
    const left = itemHash({ b: 2, a: 1 })
    const right = itemHash({ a: 1, b: 2 })
    const changed = itemHash({ a: 1, b: 3 })
    expect(left).toBe(right)
    expect(left).not.toBe(changed)
  })
})

describe("batch content fingerprint", () => {
  it("ignores generatedAt and the stored fingerprint", () => {
    const first = batch("2026-01-01T00:00:00.000Z")
    const second = { ...first, generatedAt: "2026-02-02T00:00:00.000Z" }
    const third = { ...first, contentSha256: "f".repeat(64) }

    expect(batchContentFingerprint(first)).toBe(batchContentFingerprint(second))
    expect(batchContentFingerprint(first)).toBe(batchContentFingerprint(third))
  })

  it("changes when the content changes", () => {
    const first = batch("2026-01-01T00:00:00.000Z")
    const changed = { ...first, label: "Other batch" }
    expect(batchContentFingerprint(first)).not.toBe(
      batchContentFingerprint(changed)
    )
  })
})
