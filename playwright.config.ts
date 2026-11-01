import "dotenv/config"

import path from "node:path"

import { defineConfig, devices } from "@playwright/test"

const port = 3100
const baseURL = `http://localhost:${port}`
const databaseUrl = path.join(process.cwd(), ".playwright", "test.db")
const registrationCode = process.env.REGISTRATION_CODE
const contactEmail = process.env.CONTACT_EMAIL

if (!registrationCode) {
  throw new Error(
    "REGISTRATION_CODE must be set in .env to run the auth tests."
  )
}

if (!contactEmail) {
  throw new Error(
    "CONTACT_EMAIL must be set in .env to run the review UI tests."
  )
}

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // Playwright talks to one shared `next dev` server. More workers compile and
  // stream routes concurrently, which makes short assertions flaky without
  // making the suite meaningfully faster. CI stays fully serial.
  workers: process.env.CI ? 1 : 2,
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
      CONTACT_EMAIL: contactEmail,
      REVIEW_DATA_ROOT: path.join(
        process.cwd(),
        "e2e",
        "fixtures",
        "review-data"
      ),
    },
  },
})
