import { mkdtemp, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

let temporaryDir: string
let databasePath: string

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

beforeEach(async () => {
  temporaryDir = await mkdtemp(path.join(os.tmpdir(), "review-pls-db-"))
  databasePath = path.join(temporaryDir, "lazy.db")
  process.env.DATABASE_URL = databasePath
  vi.resetModules()
})

afterEach(async () => {
  delete process.env.DATABASE_URL
  await rm(temporaryDir, { recursive: true, force: true })
})

describe("db", () => {
  it("does not open the database at import time", async () => {
    await import("@/db")

    expect(await exists(databasePath)).toBe(false)
  })

  it("opens the database on first use", async () => {
    const { db } = await import("@/db")

    expect(typeof db.select).toBe("function")
    expect(await exists(databasePath)).toBe(true)

    const client = Reflect.get(db, "$client") as { close(): void }
    client.close()
  })
})
