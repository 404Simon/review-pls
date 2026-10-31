import { describe, expect, it } from "vitest"

import {
  contentDisposition,
  contentTypeFor,
  evidenceErrnoResponse,
  jsonError,
  parsePathSegments,
  parseRangeHeader,
  searchOutcomeResponse,
  searchQuerySchema,
  treeQuerySchema,
} from "@/lib/review/api"

describe("path segments", () => {
  it("joins ordinary segments", () => {
    expect(parsePathSegments(["code", "repo", "train.py"])).toBe(
      "code/repo/train.py"
    )
  })

  it("rejects traversal, absolute and slash-containing segments", () => {
    expect(parsePathSegments([])).toBeNull()
    expect(parsePathSegments(["..", "batch.json"])).toBeNull()
    expect(parsePathSegments(["."])).toBeNull()
    expect(parsePathSegments(["a/b"])).toBeNull()
    expect(parsePathSegments(["a\\b"])).toBeNull()
    expect(parsePathSegments(["a\u0000b"])).toBeNull()
    expect(parsePathSegments(["/etc", "passwd"])).toBeNull()
  })

  it("keeps already-decoded and literal percent sequences as file names", () => {
    expect(parsePathSegments(["code", "my repo", "train.py"])).toBe(
      "code/my repo/train.py"
    )
    expect(parsePathSegments(["code", "notes%20file.py"])).toBe(
      "code/notes%20file.py"
    )
    expect(parsePathSegments(["100%.py"])).toBe("100%.py")
  })

  it("rejects double-encoded traversal", () => {
    expect(parsePathSegments(["%2e%2e", "batch.json"])).toBeNull()
    expect(parsePathSegments(["..%2F..%2Fbatch.json"])).toBeNull()
    expect(parsePathSegments(["a%2Fb"])).toBeNull()
    expect(parsePathSegments(["a%5Cb"])).toBeNull()
  })

  it("caps the segment count", () => {
    expect(parsePathSegments(Array.from({ length: 65 }, () => "a"))).toBeNull()
  })
})

describe("content types", () => {
  it("serves PDFs and text inline", () => {
    expect(contentTypeFor("paper.pdf")).toEqual({
      contentType: "application/pdf",
      disposition: "inline",
    })
    expect(contentTypeFor("notes.md").contentType).toBe(
      "text/markdown; charset=utf-8"
    )
    expect(contentTypeFor("train.py")).toEqual({
      contentType: "text/plain; charset=utf-8",
      disposition: "inline",
    })
  })

  it("never renders HTML or unknown formats inline", () => {
    expect(contentTypeFor("index.html").disposition).toBe("attachment")
    expect(contentTypeFor("archive.bin").contentType).toBe(
      "application/octet-stream"
    )
  })

  it("handles dotfiles explicitly", () => {
    expect(contentTypeFor(".gitignore")).toEqual({
      contentType: "text/plain; charset=utf-8",
      disposition: "inline",
    })
    expect(contentTypeFor(".dockerignore").disposition).toBe("inline")
  })

  it("builds a safe content disposition", () => {
    expect(contentDisposition('a"b.txt', "attachment")).toContain(
      'filename="a_b.txt"'
    )
    expect(contentDisposition("a b.txt", "inline")).toContain(
      "filename*=UTF-8''a%20b.txt"
    )
  })

  it("uses an ASCII fallback and RFC 5987 for non-ASCII names", () => {
    const header = contentDisposition("emoji-😀.txt", "inline")
    expect(header).toContain('filename="emoji-__.txt"')
    expect(header).toContain("filename*=UTF-8''emoji-%F0%9F%98%80.txt")
    expect(() => new Headers({ "Content-Disposition": header })).not.toThrow()
  })
})

describe("parseRangeHeader", () => {
  it("parses bounded, open and suffix ranges", () => {
    expect(parseRangeHeader("bytes=0-9", 100)).toEqual({ start: 0, end: 9 })
    expect(parseRangeHeader("bytes=10-", 100)).toEqual({
      start: 10,
      end: 99,
    })
    expect(parseRangeHeader("bytes=-5", 100)).toEqual({ start: 95, end: 99 })
  })

  it("clamps the end to the file size", () => {
    expect(parseRangeHeader("bytes=90-500", 100)).toEqual({
      start: 90,
      end: 99,
    })
  })

  it("returns null without a range and invalid for bad ranges", () => {
    expect(parseRangeHeader(null, 100)).toBeNull()
    expect(parseRangeHeader("", 100)).toBeNull()
    expect(parseRangeHeader("items=0-9", 100)).toBe("invalid")
    expect(parseRangeHeader("bytes=0-9,20-29", 100)).toBe("invalid")
    expect(parseRangeHeader("bytes=100-", 100)).toBe("invalid")
    expect(parseRangeHeader("bytes=9-1", 100)).toBe("invalid")
    expect(parseRangeHeader("bytes=0-1", 0)).toBe("invalid")
  })
})

describe("query schemas", () => {
  it("accepts valid tree and search queries", () => {
    expect(
      treeQuerySchema.safeParse({
        batch: "r16fix5",
        paper: "1171",
        scope: "code",
      }).success
    ).toBe(true)
    expect(
      searchQuerySchema.safeParse({
        batch: "r16fix5",
        paper: "1171",
        scope: "paper",
        q: "  seed  ",
      }).success
    ).toBe(true)
  })

  it("rejects unknown scopes, unsafe ids and control characters", () => {
    expect(
      treeQuerySchema.safeParse({
        batch: "../x",
        paper: "1171",
        scope: "code",
      }).success
    ).toBe(false)
    expect(
      treeQuerySchema.safeParse({
        batch: "r16fix5",
        paper: "1171",
        scope: "secrets",
      }).success
    ).toBe(false)
    expect(
      searchQuerySchema.safeParse({
        batch: "r16fix5",
        paper: "1171",
        scope: "paper",
        q: "\u0000",
      }).success
    ).toBe(false)
    expect(
      searchQuerySchema.safeParse({
        batch: "r16fix5",
        paper: "1171",
        scope: "paper",
        q: "   ",
      }).success
    ).toBe(false)
    expect(
      searchQuerySchema.safeParse({
        batch: "r16fix5",
        paper: "1171",
        scope: "paper",
        q: "x".repeat(201),
      }).success
    ).toBe(false)
    expect(
      searchQuerySchema.safeParse({
        batch: "r16fix5",
        paper: "1171",
        scope: "paper",
        q: "line\nbreak",
      }).success
    ).toBe(false)
  })
})

describe("evidenceErrnoResponse", () => {
  function errno(code: string): NodeJS.ErrnoException {
    return Object.assign(new Error(code), { code })
  }

  it("maps permission errors to 403", async () => {
    for (const code of ["EACCES", "EPERM"]) {
      const response = evidenceErrnoResponse(errno(code))
      expect(response?.status).toBe(403)
      expect(await response?.json()).toEqual({
        error: "forbidden",
        message: "The evidence file is not readable.",
      })
    }
  })

  it("maps missing, directory and loop errors to 404", () => {
    for (const code of ["ENOENT", "ENOTDIR", "EISDIR", "ELOOP"]) {
      expect(evidenceErrnoResponse(errno(code))?.status).toBe(404)
    }
  })

  it("rethrows unexpected errors", () => {
    expect(evidenceErrnoResponse(new Error("boom"))).toBeNull()
    expect(evidenceErrnoResponse(errno("EMFILE"))).toBeNull()
    expect(evidenceErrnoResponse("not an error")).toBeNull()
  })
})

describe("jsonError", () => {
  it("returns a JSON error body", async () => {
    const response = jsonError(401, "unauthorized", "sign in")
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: "unauthorized",
      message: "sign in",
    })
  })
})

describe("searchOutcomeResponse", () => {
  it("returns 503 when ripgrep is unavailable", async () => {
    const response = searchOutcomeResponse({
      results: [],
      truncated: false,
      unavailable: true,
    })
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: "search_unavailable",
      message:
        "Ripgrep is not installed on this server; code search is unavailable.",
    })
  })

  it("returns results and the truncation flag", async () => {
    const response = searchOutcomeResponse({
      results: [{ line: 1 }],
      truncated: true,
      unavailable: false,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      results: [{ line: 1 }],
      truncated: true,
    })
  })
})
