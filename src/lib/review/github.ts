/**
 * Pure helpers for supplementary GitHub links. These run on the server and in
 * the browser, so they must not import Node APIs.
 *
 * The local review snapshot stays the source of truth. A GitHub link is only
 * produced for canonical `https://github.com/<owner>/<repo>` targets and a
 * valid commit; everything else falls back to no link.
 */

export interface GithubRepoRef {
  /** Manifest name, e.g. `Legenddddd__MEL`. */
  name: string
  /** Explicit canonical URL from `batch.json`, when present. */
  url?: string | null
  /** Full or abbreviated commit hash. */
  commit?: string | null
}

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/
const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/i

function isValidOwner(value: string): boolean {
  return OWNER_PATTERN.test(value)
}

function isValidRepoName(value: string): boolean {
  return (
    REPO_PATTERN.test(value) &&
    value !== "." &&
    value !== ".." &&
    !value.includes("..")
  )
}

function canonicalRepoUrl(owner: string, repo: string): string | null {
  if (!isValidOwner(owner) || !isValidRepoName(repo)) {
    return null
  }
  return `https://github.com/${owner}/${repo}`
}

/**
 * Derive a GitHub URL from a prepared repository directory name such as
 * `Legenddddd__MEL`. Names that are not `owner__repo` shaped (workspaces,
 * supplements, arbitrary mounts) return null.
 */
export function githubRepoUrlFromName(name: string): string | null {
  const separator = name.indexOf("__")
  if (separator <= 0) {
    return null
  }
  return canonicalRepoUrl(name.slice(0, separator), name.slice(separator + 2))
}

/** Accept only a plain `https://github.com/<owner>/<repo>` URL. */
export function normalizeGithubRepoUrl(
  url: string | null | undefined
): string | null {
  if (!url) {
    return null
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "github.com" ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    return null
  }
  const match = /^\/([^/]+)\/([^/]+)\/?$/.exec(parsed.pathname)
  if (!match) {
    return null
  }
  return canonicalRepoUrl(match[1], match[2])
}

/**
 * Use the manifest URL when it is present, and only fall back to the repo name
 * when no URL was recorded. An explicit non-GitHub or malformed URL is a data
 * statement, not an invitation to guess another repository.
 */
export function resolveGithubRepoUrl(repo: GithubRepoRef): string | null {
  if (repo.url !== null && repo.url !== undefined) {
    return normalizeGithubRepoUrl(repo.url)
  }
  return githubRepoUrlFromName(repo.name)
}

/**
 * Label for a link to the repository on GitHub.
 *
 * Manifest names are filesystem-safe, so a repository is stored as
 * `owner__repo`. GitHub itself calls it `owner/repo`, which is what the link
 * should read. Repositories without a canonical GitHub URL keep their local
 * name, because there is no `owner/repo` to show.
 */
export function githubRepoLabel(repo: GithubRepoRef): string {
  const url = resolveGithubRepoUrl(repo)
  if (!url) {
    return repo.name
  }
  return new URL(url).pathname.replace(/^\/+/, "")
}

export function isValidGithubCommit(
  value: string | null | undefined
): value is string {
  return typeof value === "string" && COMMIT_PATTERN.test(value)
}

function normalizedCommit(commit: string | null | undefined): string | null {
  return isValidGithubCommit(commit) ? commit.toLowerCase() : null
}

/**
 * Repository tree pinned to the reviewed commit. A snapshot without a valid
 * commit gets no tree link: the repository root would show a different
 * revision than the evidence the reviewer is looking at.
 */
export function githubTreeUrl(repo: GithubRepoRef): string | null {
  const base = resolveGithubRepoUrl(repo)
  const commit = normalizedCommit(repo.commit)
  if (!base || !commit) {
    return null
  }
  return `${base}/tree/${commit}`
}

function encodeRepoPath(filePath: string): string | null {
  const normalized = filePath.replace(/^\.\//, "")
  if (normalized === "" || normalized.includes("\\")) {
    return null
  }
  const segments = normalized.split("/")
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === ".."
    )
  ) {
    return null
  }
  return segments.map(encodeURIComponent).join("/")
}

/**
 * GitHub line fragment. Only a positive integer start is used; a reversed,
 * fractional or negative range is dropped rather than encoded. A citation past
 * the end of the file still produces a valid fragment because GitHub clamps it
 * to the last line of the blob.
 */
function lineFragment(
  lineStart: number | null | undefined,
  lineEnd: number | null | undefined
): string {
  if (
    typeof lineStart !== "number" ||
    !Number.isInteger(lineStart) ||
    lineStart <= 0
  ) {
    return ""
  }
  const end =
    typeof lineEnd === "number" &&
    Number.isInteger(lineEnd) &&
    lineEnd > lineStart
      ? lineEnd
      : null
  return end === null ? `#L${lineStart}` : `#L${lineStart}-L${end}`
}

/**
 * Blob URL for a repo-relative path at the commit, with an optional line
 * range. Returns null without a valid commit or path.
 */
export function githubBlobUrl(
  repo: GithubRepoRef,
  filePath: string,
  lineStart?: number | null,
  lineEnd?: number | null
): string | null {
  const base = resolveGithubRepoUrl(repo)
  const commit = normalizedCommit(repo.commit)
  const encodedPath = encodeRepoPath(filePath)
  if (!base || !commit || !encodedPath) {
    return null
  }
  return `${base}/blob/${commit}/${encodedPath}${lineFragment(lineStart, lineEnd)}`
}
