import path from "node:path"

const IGNORED_NAMES = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".venv",
  ".DS_Store",
])

/**
 * Transient and VCS paths that are never evidence. Shared by the resolver, the
 * tree walker, the search excludes and the evidence route so all agree.
 */
export function isIgnoredEntry(name: string): boolean {
  return (
    IGNORED_NAMES.has(name) ||
    name.startsWith(".env") ||
    name.endsWith(".pyc") ||
    name.endsWith(".sif") ||
    name === "trajectory.json"
  )
}

export function isIgnoredRelativePath(relative: string): boolean {
  return relative.split(/[\\/]+/).some((segment) => isIgnoredEntry(segment))
}

/** True when `candidate` is `root` or below it, using lexical path rules. */
export function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  )
}

/**
 * Join a manifest-relative path onto a root, rejecting absolute paths and
 * traversal outside the root. Returns null when the result escapes.
 */
export function joinWithin(root: string, relative: string): string | null {
  if (path.isAbsolute(relative)) {
    return null
  }
  const absolute = path.resolve(root, relative)
  return isWithin(root, absolute) ? absolute : null
}

/** Reject absolute paths and any `..` segment before resolution. */
export function hasTraversal(relative: string): boolean {
  if (path.isAbsolute(relative)) {
    return true
  }
  return relative.split(/[\\/]+/).some((segment) => segment === "..")
}
