import "dotenv/config"

import { chmod, mkdir, open, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test"

const registrationCode = process.env.REGISTRATION_CODE
const password = "correct-horse-42"

if (!registrationCode) {
  throw new Error(
    "REGISTRATION_CODE must be set in .env to run the evidence tests."
  )
}

function uniqueEmail() {
  return `evidence-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
}

async function createUser(request: APIRequestContext, email: string) {
  const response = await request.post("/api/auth/sign-up/email", {
    data: {
      name: "Evidence Reviewer",
      email,
      password,
      loginCode: registrationCode,
    },
  })
  expect(response.ok()).toBeTruthy()
}

async function signIn(page: Page, email: string) {
  // Sign in through the same HTTP endpoint the form uses. The page's request
  // context shares cookies with the browser, so this still exercises the real
  // session while avoiding client-hydration races in the dev server. The auth
  // spec covers the sign-in form itself.
  const response = await page.request.post("/api/auth/sign-in/email", {
    data: { email, password },
  })
  expect(response.ok()).toBeTruthy()
}

async function signedInPage(page: Page, request: APIRequestContext) {
  const email = uniqueEmail()
  await createUser(request, email)
  await signIn(page, email)
}

const pdfUrl = "/api/evidence/review-fixture/1001/paper.pdf"
const itemUrl = "/batches/review-fixture/items/cluster:1001:M01"
const fixturePaperDir = path.join(
  process.cwd(),
  "e2e",
  "fixtures",
  "review-data",
  "review-fixture",
  "papers",
  "1001"
)
const evidenceBase = "/api/evidence/review-fixture/1001"

test("unauthorised evidence requests return 401 JSON", async ({ request }) => {
  const response = await request.get(pdfUrl)
  expect(response.status()).toBe(401)
  expect(await response.json()).toEqual({
    error: "unauthorized",
    message: "Sign in to read review evidence.",
  })

  const tree = await request.get(
    "/api/tree?batch=review-fixture&paper=1001&scope=code"
  )
  expect(tree.status()).toBe(401)

  const search = await request.get(
    "/api/search?batch=review-fixture&paper=1001&scope=paper&q=seed"
  )
  expect(search.status()).toBe(401)
})

test("serves PDF ranges and blocks traversal", async ({ page, request }) => {
  await signedInPage(page, request)

  const full = await page.request.get(pdfUrl)
  expect(full.status()).toBe(200)
  expect(full.headers()["content-type"]).toBe("application/pdf")
  expect(full.headers()["x-content-type-options"]).toBe("nosniff")
  expect(full.headers()["cache-control"]).toBe(
    "private, max-age=0, must-revalidate"
  )
  expect(full.headers()["content-disposition"]).toContain("inline")

  const range = await page.request.get(pdfUrl, {
    headers: { Range: "bytes=0-9" },
  })
  expect(range.status()).toBe(206)
  expect(range.headers()["content-range"]).toMatch(/^bytes 0-9\/\d+$/)
  expect((await range.body()).length).toBe(10)

  const head = await page.request.fetch(pdfUrl, { method: "HEAD" })
  expect(head.status()).toBe(200)
  expect(head.headers()["accept-ranges"]).toBe("bytes")

  const download = await page.request.get(`${pdfUrl}?download=1`)
  expect(download.headers()["content-disposition"]).toContain("attachment")

  const traversal = await page.request.get(
    "/api/evidence/review-fixture/1001/..%2F..%2Fbatch.json"
  )
  expect([400, 404]).toContain(traversal.status())
  expect(await traversal.text()).not.toContain("contentSha256")

  const doubleEncoded = await page.request.get(
    "/api/evidence/review-fixture/1001/..%252F..%252Fbatch.json"
  )
  expect([400, 404]).toContain(doubleEncoded.status())
  expect(await doubleEncoded.text()).not.toContain("contentSha256")
})

test("streams files and bounds range responses", async ({ page, request }) => {
  await signedInPage(page, request)
  const name = `large-stream-${Date.now()}.bin`
  const absolute = path.join(fixturePaperDir, "code", "fixturerepo", name)
  const size = 8 * 1024 * 1024
  const handle = await open(absolute, "w")
  try {
    await handle.truncate(size)
  } finally {
    await handle.close()
  }
  const url = `${evidenceBase}/code/fixturerepo/${name}`
  try {
    const head = await page.request.fetch(url, { method: "HEAD" })
    expect(head.status()).toBe(200)
    expect(head.headers()["content-length"]).toBe(String(size))
    expect(head.headers()["accept-ranges"]).toBe("bytes")
    expect((await head.body()).length).toBe(0)

    const range = await page.request.get(url, {
      headers: { Range: "bytes=100-199" },
    })
    expect(range.status()).toBe(206)
    expect(range.headers()["content-range"]).toBe(`bytes 100-199/${size}`)
    expect((await range.body()).length).toBe(100)

    const badRange = await page.request.get(url, {
      headers: { Range: `bytes=${size + 10}-` },
    })
    expect(badRange.status()).toBe(416)
    expect(badRange.headers()["accept-ranges"]).toBe("bytes")
    expect(badRange.headers()["content-range"]).toBe(`bytes */${size}`)

    const full = await page.request.get(url)
    expect(full.status()).toBe(200)
    expect(full.headers()["content-length"]).toBe(String(size))
    expect((await full.body()).length).toBe(size)
  } finally {
    await rm(absolute, { force: true })
  }
})

test("blocks ignored paths and handles unusual file names", async ({
  page,
  request,
}) => {
  await signedInPage(page, request)

  // `.git` cannot be committed as a nested repository and `.env*` is ignored,
  // so portable runs recreate them at runtime instead of relying on the tree.
  const gitDir = path.join(fixturePaperDir, "code", "fixturerepo", ".git")
  const envFile = path.join(fixturePaperDir, "code", "fixturerepo", ".env")
  await mkdir(gitDir, { recursive: true })
  await writeFile(path.join(gitDir, "config"), "[core]\n", "utf8")
  await writeFile(envFile, "SECRET=fixture\n", "utf8")

  try {
    for (const ignored of [
      "code/fixturerepo/.git/config",
      "code/fixturerepo/node_modules/pkg/index.js",
      "code/fixturerepo/trajectory.json",
      "code/fixturerepo/.env",
      "code/fixturerepo/__pycache__/train.cpython-312.pyc",
    ]) {
      const response = await page.request.get(`${evidenceBase}/${ignored}`)
      expect(response.status(), ignored).toBe(404)
    }
  } finally {
    await rm(gitDir, { recursive: true, force: true })
    await rm(envFile, { force: true })
  }

  const empty = await page.request.get(
    `${evidenceBase}/code/fixturerepo/empty.txt`
  )
  expect(empty.status()).toBe(200)
  expect(empty.headers()["content-length"]).toBe("0")
  expect((await empty.body()).length).toBe(0)

  const literalPercent = await page.request.get(
    `${evidenceBase}/code/fixturerepo/notes%2520file.py`
  )
  expect(literalPercent.status()).toBe(200)

  const spaceName = await page.request.get(
    `${evidenceBase}/code/fixturerepo/space%20name.py`
  )
  expect(spaceName.status()).toBe(200)

  const unicode = await page.request.get(
    `${evidenceBase}/code/fixturerepo/${encodeURIComponent("emoji-😀.txt")}`
  )
  expect(unicode.status()).toBe(200)
  const disposition = unicode.headers()["content-disposition"] ?? ""
  expect(disposition).toContain('filename="emoji-__.txt"')
  expect(disposition).toContain("filename*=UTF-8''emoji-%F0%9F%98%80.txt")

  if (process.getuid?.() !== 0) {
    const unreadable = path.join(
      fixturePaperDir,
      "run",
      "out",
      "unreadable.txt"
    )
    await chmod(unreadable, 0o000)
    try {
      const response = await page.request.get(
        `${evidenceBase}/run/out/unreadable.txt`
      )
      expect(response.status()).toBe(403)
    } finally {
      await chmod(unreadable, 0o644)
    }
  }
})

test("serves item pages for plain and encoded item ids", async ({
  page,
  request,
}) => {
  await signedInPage(page, request)
  for (const url of [
    "/batches/review-fixture/items/cluster:1001:M01",
    "/batches/review-fixture/items/cluster%3A1001%3AM01",
  ]) {
    const response = await page.request.get(url)
    expect(response.status(), url).toBe(200)
    await page.goto(url)
    await expect(
      page.getByRole("heading", {
        name: "Test statistics leak into augmentation search",
        level: 1,
      })
    ).toBeVisible()
  }
})

test("renders code, checks, paper and report evidence", async ({
  page,
  request,
}) => {
  await signedInPage(page, request)
  // Warm the dev route before navigating; the first compile can otherwise
  // abort a browser navigation.
  expect((await page.request.get(itemUrl)).status()).toBe(200)
  await page.goto(itemUrl)

  await expect(
    page.getByRole("heading", {
      name: "Test statistics leak into augmentation search",
      level: 1,
    })
  ).toBeVisible()
  await expect(page.getByText("LLM comparator")).toBeVisible()
  await expect(page.getByRole("tab", { name: /Code/ })).toBeVisible()

  await expect(page.getByText("quote exact").first()).toBeVisible()
  await expect(
    page.getByText("code/fixturerepo/train.py").first()
  ).toBeVisible()

  await page.getByRole("tab", { name: /Checks/ }).click()
  await expect(
    page.getByRole("tab", { name: "check_split.csv" }).first()
  ).toBeVisible()
  await page.getByRole("tab", { name: "check_split.csv" }).first().click()
  await expect(
    page.getByText("test split used for augmentation selection").first()
  ).toBeVisible()
  await expect(page.getByLabel("Filter CSV rows").first()).toBeVisible()

  await page.getByRole("tab", { name: /Paper/ }).click()
  await expect(page.getByTitle("Paper PDF")).toHaveCount(1)
  await expect(page.getByTitle("Paper PDF")).toHaveAttribute("src", /#page=3/)
  await expect(page.getByText("p. 2").first()).toBeVisible()

  // One shared iframe: a page link on any finding updates the same viewer.
  await page.getByRole("button", { name: "Show page 2" }).first().click()
  await expect(page.getByTitle("Paper PDF")).toHaveCount(1)
  await expect(page.getByTitle("Paper PDF")).toHaveAttribute("src", /#page=2/)

  await page.getByLabel("Search the paper text").first().fill("test split")
  await page
    .getByRole("button", { name: "Search", exact: true })
    .first()
    .click()
  await expect(page.getByText(/We select augmentations/).first()).toBeVisible()

  await page.getByRole("tab", { name: /Reports/ }).click()
  await expect(page.getByText("Finding a1:").first()).toBeVisible()
  await expect(page.getByText("Open full report").first()).toBeVisible()
})
