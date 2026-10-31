import { describe, expect, it } from "vitest"

import {
  githubBlobUrl,
  githubCommitUrl,
  githubRepoUrlFromName,
  githubTreeUrl,
  isValidGithubCommit,
  normalizeGithubRepoUrl,
  resolveGithubRepoUrl,
} from "@/lib/review/github"

const commit = "0123456789abcdef0123456789abcdef01234567"
const repo = {
  name: "Legenddddd__MEL",
  url: null,
  commit,
}

describe("githubRepoUrlFromName", () => {
  it("derives owner and repository from owner__repo names", () => {
    expect(githubRepoUrlFromName("Legenddddd__MEL")).toBe(
      "https://github.com/Legenddddd/MEL"
    )
    expect(githubRepoUrlFromName("owner__repo_name")).toBe(
      "https://github.com/owner/repo_name"
    )
  })

  it("splits at the first separator", () => {
    expect(githubRepoUrlFromName("owner__repo__extra")).toBe(
      "https://github.com/owner/repo__extra"
    )
  })

  it("rejects names that are not owner__repo shaped", () => {
    for (const name of [
      "fixturerepo",
      "owner",
      "__repo",
      "owner__",
      "owner__ repo",
      "owner__repo name",
      "owner__../repo",
      "owner__repo/extra",
      "owner/name__repo",
      "owner__..",
      "owner__.",
    ]) {
      expect(githubRepoUrlFromName(name), name).toBeNull()
    }
  })
})

describe("normalizeGithubRepoUrl", () => {
  it("accepts canonical repository URLs with an optional trailing slash", () => {
    expect(normalizeGithubRepoUrl("https://github.com/owner/repo")).toBe(
      "https://github.com/owner/repo"
    )
    expect(normalizeGithubRepoUrl("https://github.com/owner/repo/")).toBe(
      "https://github.com/owner/repo"
    )
  })

  it("rejects other hosts, protocols, credentials and extra parts", () => {
    for (const url of [
      "http://github.com/owner/repo",
      "https://gitlab.com/owner/repo",
      "https://www.github.com/owner/repo",
      "https://github.com.evil.test/owner/repo",
      "https://user:pass@github.com/owner/repo",
      "https://github.com/owner/repo?tab=readme",
      "https://github.com/owner/repo#readme",
      "https://github.com/owner/repo/tree/main",
      "https://github.com/owner",
      "https://github.com/owner/repo//",
      "javascript:alert(1)",
      "",
    ]) {
      expect(normalizeGithubRepoUrl(url), url).toBeNull()
    }
    expect(normalizeGithubRepoUrl(null)).toBeNull()
  })
})

describe("resolveGithubRepoUrl", () => {
  it("prefers a valid manifest URL", () => {
    expect(
      resolveGithubRepoUrl({
        name: "ignored__name",
        url: "https://github.com/example/fixturerepo/",
      })
    ).toBe("https://github.com/example/fixturerepo")
  })

  it("falls back to the repo name only when no URL is present", () => {
    expect(resolveGithubRepoUrl({ name: "Owner__Repo", url: null })).toBe(
      "https://github.com/Owner/Repo"
    )
    expect(resolveGithubRepoUrl({ name: "Owner__Repo" })).toBe(
      "https://github.com/Owner/Repo"
    )
  })

  it("does not replace an explicit non-GitHub URL with a name guess", () => {
    for (const url of [
      "https://example.org/not-github",
      "https://github.com/owner/repo/tree/main",
      "not a url",
      "",
    ]) {
      expect(resolveGithubRepoUrl({ name: "Owner__Repo", url }), url).toBeNull()
    }
  })
})

describe("isValidGithubCommit", () => {
  it("accepts 7 to 40 hex characters", () => {
    expect(isValidGithubCommit("0123456")).toBe(true)
    expect(isValidGithubCommit(commit)).toBe(true)
    expect(isValidGithubCommit(commit.toUpperCase())).toBe(true)
  })

  it("rejects short, long and non-hex values", () => {
    for (const value of [
      "012345",
      "g123456",
      "0123456789abcdef0123456789abcdef012345678",
      "",
      null,
      undefined,
      "main",
    ]) {
      expect(isValidGithubCommit(value), String(value)).toBe(false)
    }
  })
})

describe("githubTreeUrl", () => {
  it("pins the tree to the commit", () => {
    expect(githubTreeUrl(repo)).toBe(
      `https://github.com/Legenddddd/MEL/tree/${commit}`
    )
  })

  it("returns no tree without a valid commit", () => {
    expect(githubTreeUrl({ ...repo, commit: null })).toBeNull()
    expect(githubTreeUrl({ ...repo, commit: undefined })).toBeNull()
    expect(githubTreeUrl({ ...repo, commit: "not-a-commit" })).toBeNull()
  })

  it("returns null when the repository is not linkable", () => {
    expect(githubTreeUrl({ name: "fixturerepo", commit })).toBeNull()
  })
})

describe("githubCommitUrl", () => {
  it("builds the commit page only for a valid commit", () => {
    expect(githubCommitUrl(repo)).toBe(
      `https://github.com/Legenddddd/MEL/commit/${commit}`
    )
    expect(githubCommitUrl({ ...repo, commit: null })).toBeNull()
    expect(githubCommitUrl({ ...repo, commit: "main" })).toBeNull()
  })
})

describe("githubBlobUrl", () => {
  it("builds a blob URL with a line range", () => {
    expect(githubBlobUrl(repo, "src/train.py", 10, 14)).toBe(
      `https://github.com/Legenddddd/MEL/blob/${commit}/src/train.py#L10-L14`
    )
  })

  it("uses a single line anchor and ignores reversed ranges", () => {
    expect(githubBlobUrl(repo, "train.py", 10)).toBe(
      `https://github.com/Legenddddd/MEL/blob/${commit}/train.py#L10`
    )
    expect(githubBlobUrl(repo, "train.py", 10, 10)).toBe(
      `https://github.com/Legenddddd/MEL/blob/${commit}/train.py#L10`
    )
    expect(githubBlobUrl(repo, "train.py", 10, 4)).toBe(
      `https://github.com/Legenddddd/MEL/blob/${commit}/train.py#L10`
    )
  })

  it("omits the fragment without line information", () => {
    expect(githubBlobUrl(repo, "train.py", null, null)).toBe(
      `https://github.com/Legenddddd/MEL/blob/${commit}/train.py`
    )
    expect(githubBlobUrl(repo, "train.py", 0, 0)).toBe(
      `https://github.com/Legenddddd/MEL/blob/${commit}/train.py`
    )
  })

  it("drops negative, fractional and non-finite line values", () => {
    expect(githubBlobUrl(repo, "train.py", -3, -1)).toBe(
      `https://github.com/Legenddddd/MEL/blob/${commit}/train.py`
    )
    expect(githubBlobUrl(repo, "train.py", 1.5, 2.5)).toBe(
      `https://github.com/Legenddddd/MEL/blob/${commit}/train.py`
    )
    expect(githubBlobUrl(repo, "train.py", Number.NaN, null)).toBe(
      `https://github.com/Legenddddd/MEL/blob/${commit}/train.py`
    )
    expect(githubBlobUrl(repo, "train.py", 10, 4.5)).toBe(
      `https://github.com/Legenddddd/MEL/blob/${commit}/train.py#L10`
    )
  })

  it("keeps a citation past EOF so GitHub clamps it to the last line", () => {
    // The local preview never highlights a line past EOF; the link is still a
    // useful navigation aid and GitHub clamps an out-of-range anchor itself.
    expect(githubBlobUrl(repo, "train.py", 405, 409)).toBe(
      `https://github.com/Legenddddd/MEL/blob/${commit}/train.py#L405-L409`
    )
  })

  it("encodes each path segment but preserves slashes", () => {
    expect(githubBlobUrl(repo, "src/my file.py", 1)).toBe(
      `https://github.com/Legenddddd/MEL/blob/${commit}/src/my%20file.py#L1`
    )
    expect(githubBlobUrl(repo, "notes%20file.py", 1)).toBe(
      `https://github.com/Legenddddd/MEL/blob/${commit}/notes%2520file.py#L1`
    )
    expect(githubBlobUrl(repo, "issue#1.py", 1)).toBe(
      `https://github.com/Legenddddd/MEL/blob/${commit}/issue%231.py#L1`
    )
    expect(githubBlobUrl(repo, "emoji-😀.txt", 2)).toBe(
      `https://github.com/Legenddddd/MEL/blob/${commit}/emoji-%F0%9F%98%80.txt#L2`
    )
  })

  it("strips a leading ./ but rejects traversal and absolute paths", () => {
    expect(githubBlobUrl(repo, "./src/train.py")).toBe(
      `https://github.com/Legenddddd/MEL/blob/${commit}/src/train.py`
    )
    for (const filePath of [
      "",
      "/etc/passwd",
      "../secret.py",
      "src/../../secret.py",
      "src//train.py",
      "src\\train.py",
    ]) {
      expect(githubBlobUrl(repo, filePath), filePath).toBeNull()
    }
  })

  it("returns null without a valid commit", () => {
    expect(githubBlobUrl({ ...repo, commit: null }, "train.py", 1)).toBeNull()
    expect(githubBlobUrl({ ...repo, commit: "main" }, "train.py", 1)).toBeNull()
  })
})
