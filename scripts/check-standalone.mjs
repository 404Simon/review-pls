import { readdir, rm, stat } from "node:fs/promises"
import path from "node:path"

const args = process.argv.slice(2)
const clean = args.includes("--clean")
const rootArg = args.find((arg) => !arg.startsWith("--"))
const root = path.resolve(
  rootArg ?? path.join(process.cwd(), ".next", "standalone")
)
const MAX_BYTES = 200 * 1024 * 1024

const FORBIDDEN_NAMES = new Set([
  "review-data",
  "data",
  "exports",
  "e2e",
  "scripts",
  "src",
  ".git",
  "test-results",
  ".playwright",
])

function isForbidden(name) {
  return (
    FORBIDDEN_NAMES.has(name) ||
    name === ".env" ||
    name.startsWith(".env.") ||
    name.startsWith("local.db")
  )
}

async function totalSize(directory) {
  let bytes = 0
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      bytes += await totalSize(absolute)
    } else if (entry.isFile()) {
      bytes += (await stat(absolute)).size
    }
  }
  return bytes
}

const failures = []

let entries
try {
  entries = await readdir(root, { withFileTypes: true })
} catch {
  console.error(`standalone directory is missing: ${root}`)
  process.exit(1)
}

// Next copies loaded `.env` / `.env.production` files into the standalone
// bundle regardless of outputFileTracingExcludes. Runtime secrets come from the
// process environment, so remove those copies after the build. Any other
// forbidden entry is a tracing regression and fails below instead of being
// silently deleted.
if (clean) {
  for (const entry of entries) {
    if (entry.name === ".env" || entry.name.startsWith(".env.")) {
      await rm(path.join(root, entry.name), { force: true })
    }
  }
  entries = await readdir(root, { withFileTypes: true })
}

for (const entry of entries) {
  if (isForbidden(entry.name)) {
    failures.push(`forbidden entry in standalone output: ${entry.name}`)
  }
}

for (const required of ["server.js"]) {
  if (!entries.some((entry) => entry.name === required)) {
    failures.push(`required entry is missing: ${required}`)
  }
}

const bytes = await totalSize(root)
const megabytes = bytes / (1024 * 1024)
if (bytes > MAX_BYTES) {
  failures.push(
    `standalone output is ${megabytes.toFixed(1)} MB (limit ${(MAX_BYTES / (1024 * 1024)).toFixed(0)} MB)`
  )
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL ${failure}`)
  }
  process.exit(1)
}

console.log(
  `standalone output ok: ${megabytes.toFixed(1)} MB at ${path.relative(process.cwd(), root)}`
)
