import "dotenv/config"

import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test"

const registrationCode = process.env.REGISTRATION_CODE
const password = "correct-horse-42"

if (!registrationCode) {
  throw new Error(
    "REGISTRATION_CODE must be set in .env to run the review UI tests."
  )
}

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
}

async function createUser(request: APIRequestContext, email: string) {
  const response = await request.post("/api/auth/sign-up/email", {
    data: {
      name: "Review UI User",
      email,
      password,
      loginCode: registrationCode,
    },
  })
  expect(response.ok()).toBeTruthy()
}

async function signInRequest(request: APIRequestContext, email: string) {
  const response = await request.post("/api/auth/sign-in/email", {
    data: { email, password },
  })
  expect(response.ok()).toBeTruthy()
}

async function signedInPage(
  page: Page,
  request: APIRequestContext,
  prefix = "review"
) {
  const email = uniqueEmail(prefix)
  await createUser(request, email)
  await signInRequest(page.request, email)
  return email
}

async function newSignedInContext(browser: Browser, prefix: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const email = uniqueEmail(prefix)
  // Sign-up already establishes the session cookie for this context.
  await createUser(page.request, email)
  return { context, page, email }
}

const item = (id: string) => `/batches/review-fixture/items/${id}`

test("dashboard shows the welcome heading, paper table and severity counts", async ({
  page,
  request,
}) => {
  await signedInPage(page, request, "dashboard")
  expect((await page.request.get("/dashboard")).status()).toBe(200)
  await page.goto("/dashboard")

  await expect(
    page.getByRole("heading", { name: /Welcome back/ })
  ).toBeVisible()
  await expect(page.getByRole("table")).toBeVisible()

  const paper1001 = page.getByRole("row", {
    name: /Fixture Paper: Evidence Viewer/,
  })
  await expect(
    paper1001.getByLabel("High severity items in paper 1001: 1")
  ).toBeVisible()
  await expect(
    paper1001.getByLabel("Medium severity items in paper 1001: 1")
  ).toBeVisible()
  await expect(
    paper1001.getByLabel("Low severity items in paper 1001: 6")
  ).toBeVisible()

  const paper1002 = page.getByRole("row", {
    name: /Fixture Paper: Queue and Decisions/,
  })
  await expect(
    paper1002.getByLabel("High severity items in paper 1002: 1")
  ).toBeVisible()
  await expect(
    paper1002.getByLabel("Medium severity items in paper 1002: 1")
  ).toBeVisible()
  await expect(
    paper1002.getByLabel("Low severity items in paper 1002: 1")
  ).toBeVisible()
})

test("paper page shows tabs and item counts", async ({ page, request }) => {
  await signedInPage(page, request, "paper")
  const url = "/batches/review-fixture/papers/1001"
  expect((await page.request.get(url)).status()).toBe(200)
  await page.goto(url)

  await expect(
    page.getByRole("heading", {
      name: "Fixture Paper: Evidence Viewer",
      level: 1,
    })
  ).toBeVisible()

  const matches = page.getByRole("tab", { name: /Matches/ })
  await expect(matches).toContainText("1")
  const newFindings = page.getByRole("tab", { name: /New findings/ })
  await expect(newFindings).toContainText("4")
  const auditowl = page.getByRole("tab", { name: /AuditOwl-only/ })
  await expect(auditowl).toContainText("2")
  const related = page.getByRole("tab", { name: /Related/ })
  await expect(related).toContainText("1")

  await newFindings.click()
  await expect(
    page.getByRole("link", { name: "Checkpoint selection uses the test split" })
  ).toBeVisible()

  await page.getByRole("tab", { name: /^All/ }).click()
  await expect(
    page.getByRole("link", {
      name: /Related pair: o3 \/ a3/,
    })
  ).toBeVisible()
})

test("reserves, closes a cluster decision and makes it read-only", async ({
  page,
  request,
}) => {
  await signedInPage(page, request, "cluster")
  const url = item("cluster:1001:M01")
  expect((await page.request.get(url)).status()).toBe(200)
  await page.goto(url)

  await page.getByRole("button", { name: "Reserve" }).click()
  await expect(page.getByText("Reserved by you")).toBeVisible()

  await page
    .getByLabel("Reviewer note")
    .fill("Both sides cite the same selection loop; accept as proposed.")
  await page.getByRole("button", { name: "Save & close" }).click()
  await expect(page.getByText(/Decision saved/)).toBeVisible()

  await page.goto(url)
  await expect(page.getByText(/Closed by/).first()).toBeVisible()
  await expect(page.getByText("Final decision", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Save & close" })).toHaveCount(
    0
  )
})

test("unsure releases the claim and the next reviewer sees the note", async ({
  browser,
}) => {
  const first = await newSignedInContext(browser, "unsure-a")
  const second = await newSignedInContext(browser, "unsure-b")
  const url = item("agent_only:1001:a2")

  try {
    expect((await first.page.request.get(url)).status()).toBe(200)
    await first.page.goto(url)
    await first.page.getByRole("button", { name: "Reserve" }).click()
    await expect(first.page.getByText("Reserved by you")).toBeVisible()

    const note = "The line range needs a second look."
    await first.page.getByLabel("Reviewer note").fill(note)
    await first.page
      .getByRole("button", { name: "Mark unsure and release the claim" })
      .click()
    await expect(first.page.getByText(/Marked unsure/)).toBeVisible()

    await second.page.goto(url)
    await expect(second.page.getByText(/Marked unsure by/)).toBeVisible()
    await expect(second.page.getByText(note).first()).toBeVisible()
    await expect(
      second.page.getByRole("button", { name: "Reserve" })
    ).toBeVisible()
    await second.page.getByRole("button", { name: "Reserve" }).click()
    await expect(second.page.getByText("Reserved by you")).toBeVisible()
  } finally {
    await first.context.close()
    await second.context.close()
  }
})

test("autosaved draft survives a reload", async ({ page, request }) => {
  await signedInPage(page, request, "draft")
  const url = item("cluster:1002:M01")
  expect((await page.request.get(url)).status()).toBe(200)
  await page.goto(url)

  await page.getByRole("button", { name: "Reserve" }).click()
  const note = "Draft note survives the reload."
  await page.getByLabel("Reviewer note").fill(note)
  await expect(page.getByText("Saved", { exact: true })).toBeVisible()

  await page.reload()
  await expect(page.getByLabel("Reviewer note")).toHaveValue(note)
  await expect(page.getByText("Reserved by you")).toBeVisible()
})

test("queue reserve reserves an item and refreshes the row", async ({
  page,
  request,
}) => {
  await signedInPage(page, request, "queue")
  const url = "/batches/review-fixture/queue"
  expect((await page.request.get(url)).status()).toBe(200)
  await page.goto(url)

  const row = page.getByRole("row", {
    name: /Random seed is reset in the training loop/,
  })
  await expect(row).toBeVisible()
  await row
    .getByRole("button", {
      name: "Reserve Random seed is reset in the training loop",
    })
    .click()
  await expect(page.getByText(/Reserved “Random seed/)).toBeVisible()
  await expect(row.getByText("Yours")).toBeVisible()
})

test("a second reviewer gets a clear claim conflict", async ({ browser }) => {
  const first = await newSignedInContext(browser, "conflict-a")
  const second = await newSignedInContext(browser, "conflict-b")
  const url = item("related:1001:o3--a3")

  try {
    await second.page.goto(url)
    await expect(
      second.page.getByRole("button", { name: "Reserve" })
    ).toBeVisible()

    await first.page.goto(url)
    await first.page.getByRole("button", { name: "Reserve" }).click()
    await expect(first.page.getByText("Reserved by you")).toBeVisible()

    await second.page.getByRole("button", { name: "Reserve" }).click()
    await expect(
      second.page.getByText(/currently reserved by another reviewer/i)
    ).toBeVisible()
  } finally {
    await first.context.close()
    await second.context.close()
  }
})

test("keyboard help opens and j moves to the next item", async ({
  page,
  request,
}) => {
  await signedInPage(page, request, "keys")
  const url = item("cluster:1002:M01")
  expect((await page.request.get(url)).status()).toBe(200)
  await page.goto(url)
  await expect(page.getByText("LLM comparator")).toBeVisible()
  // Let the client shortcut listener hydrate before pressing a shortcut.
  await page.waitForTimeout(750)

  await page.keyboard.press("?")
  await expect(
    page.getByRole("heading", { name: "Keyboard shortcuts" })
  ).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(
    page.getByRole("heading", { name: "Keyboard shortcuts" })
  ).toHaveCount(0)

  await page.keyboard.press("j")
  await expect(page).not.toHaveURL(url)
})

test("shortcuts do nothing behind the shortcut help dialog", async ({
  page,
  request,
}) => {
  await signedInPage(page, request, "shortcut-guard")
  const url = item("agent_only:1001:a4")
  await page.goto(url)
  await page.getByRole("button", { name: "Reserve" }).click()
  await expect(page.getByText("Reserved by you")).toBeVisible()
  await expect(
    page.getByText("Final decision", { exact: true })
  ).not.toBeVisible()
  await page.waitForTimeout(750)

  await page.keyboard.press("?")
  await expect(
    page.getByRole("heading", { name: "Keyboard shortcuts" })
  ).toBeVisible()

  await page.keyboard.press("s")
  await page.keyboard.press("u")
  await page.keyboard.press("2")
  await page.waitForTimeout(500)

  // Still reserved, still open, and no final decision was written behind the
  // modal.
  await expect(page.getByText("Reserved by you")).toBeVisible()
  await expect(
    page.getByText("Final decision", { exact: true })
  ).not.toBeVisible()

  await page.keyboard.press("Escape")
  await expect(
    page.getByRole("heading", { name: "Keyboard shortcuts" })
  ).toHaveCount(0)

  // After closing the dialog the same key works again.
  await page.keyboard.press("s")
  await expect(page.getByText(/Decision saved/)).toBeVisible()
})

test("tab-scoped j navigation stays inside the Matches tab", async ({
  page,
  request,
}) => {
  await signedInPage(page, request, "tab-keys")
  const url = `${item("cluster:1001:M01")}?from=paper&tab=matches`
  expect((await page.request.get(url)).status()).toBe(200)
  await page.goto(url)
  await expect(page.getByText("LLM comparator")).toBeVisible()
  await page.waitForTimeout(750)

  await page.keyboard.press("j")
  await page.waitForTimeout(500)
  await expect(page).toHaveURL(url)
})
