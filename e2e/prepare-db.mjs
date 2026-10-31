import { execFileSync } from "node:child_process"
import { mkdirSync, rmSync } from "node:fs"
import path from "node:path"

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to prepare the test database.")
}

const databasePath = path.resolve(databaseUrl)

// The Playwright server uses an isolated Next dist directory. Turbopack can
// leave stale chunks behind when an earlier dev server was killed mid-compile,
// so each e2e run starts from a clean cache. Never touch the normal `.next`
// directory used by `pnpm dev`.
const distDir = path.resolve(process.env.NEXT_DIST_DIR ?? ".next-e2e")
if (distDir !== path.resolve(".next")) {
  rmSync(distDir, { recursive: true, force: true })
}

mkdirSync(path.dirname(databasePath), { recursive: true })

for (const suffix of ["", "-shm", "-wal"]) {
  rmSync(`${databasePath}${suffix}`, { force: true })
}

execFileSync(
  process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  ["db:migrate"],
  {
    stdio: "inherit",
  }
)
