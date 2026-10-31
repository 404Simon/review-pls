import "dotenv/config"

import path from "node:path"

import { defineConfig, devices } from "@playwright/test"

const port = 3100
const baseURL = `http://localhost:${port}`
const databaseUrl = path.join(process.cwd(), ".playwright", "test.db")
const registrationCode = process.env.REGISTRATION_CODE

if (!registrationCode) {
  throw new Error(
    "REGISTRATION_CODE must be set in .env to run the auth tests."
  )
}

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `node e2e/prepare-db.mjs && pnpm dev --port ${port}`,
    url: `${baseURL}/api/auth/ok`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      BETTER_AUTH_URL: baseURL,
      DATABASE_URL: databaseUrl,
      NEXT_DIST_DIR: ".next-e2e",
      REGISTRATION_CODE: registrationCode,
      REVIEW_DATA_ROOT: path.join(
        process.cwd(),
        "e2e",
        "fixtures",
        "review-data"
      ),
    },
  },
})
