import { execFileSync } from "node:child_process"
import { mkdirSync, rmSync } from "node:fs"
import path from "node:path"

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to prepare the test database.")
}

const databasePath = path.resolve(databaseUrl)

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
