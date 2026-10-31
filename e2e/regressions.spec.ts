import "dotenv/config"

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
    "REGISTRATION_CODE must be set in .env to run the regression tests."
  )
}

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
}

async function createUser(request: APIRequestContext, email: string) {
  const response = await request.post("/api/auth/sign-up/email", {
    data: {
      name: "Regression Reviewer",
      email,
      password,
      loginCode: registrationCode,
    },
  })
  expect(response.ok()).toBeTruthy()
}

async function signedInPage(
  page: Page,
  request: APIRequestContext,
  prefix = "regression"
) {
  const email = uniqueEmail(prefix)
  await createUser(request, email)
  const response = await page.request.post("/api/auth/sign-in/email", {
    data: { email, password },
  })
  expect(response.ok()).toBeTruthy()
}

const item = (batchId: string, id: string) => `/batches/${batchId}/items/${id}`

/**
 * Hold draft autosaves at the browser for long enough that a release/discard
 * click happens while the POST is still on the wire.
 */
async function delayDraftSaves(page: Page, delayMs = 1_200) {
  await page.route("**/*", async (route) => {
    const request = route.request()
    const body = request.postData() ?? ""
    if (
      request.method() === "POST" &&
      request.headers()["next-action"] &&
      body.includes("draft")
    ) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
    await route.continue()
  })
}

/** Hold every server action so the form stays suspended mid-release/discard. */
async function delayServerActions(page: Page, delayMs = 1_200) {
  await page.route("**/*", async (route) => {
    const request = route.request()
    if (
      request.method() === "POST" &&
      request.headers()["next-action"] !== undefined
    ) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
    await route.continue()
  })
}

test("release waits for an in-flight autosave and cannot be re-claimed", async ({
  page,
  request,
}) => {
  await signedInPage(page, request, "release-race")
  const url = item("review-fixture-b", "agent_only:1001:a3")
  expect((await page.request.get(url)).status()).toBe(200)
  await page.goto(url)

  await page.getByRole("button", { name: "Reserve" }).click()
  await expect(page.getByText("Reserved by you")).toBeVisible()

  await delayDraftSaves(page)
  await page.getByLabel("Reviewer note").fill("A release race note.")
  // Let the 800 ms autosave fire into the delayed route, then release while
  // the draft POST is still in flight.
  await page.waitForTimeout(950)
  await page.getByRole("button", { name: "Release", exact: true }).click()
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Release claim" })
    .click()

  await expect(page.getByText(/Claim released/)).toBeVisible({
    timeout: 10_000,
  })
  await page.reload()

  // A late autosave must not atomically claim the item again.
  await expect(page.getByRole("button", { name: "Reserve" })).toBeVisible()
  await expect(page.getByText("Reserved by you")).toHaveCount(0)
})

test("discard waits for an in-flight autosave and cannot recreate the draft", async ({
  page,
  request,
}) => {
  await signedInPage(page, request, "discard-race")
  const url = item("review-fixture-b", "agent_only:1001:a4")
  expect((await page.request.get(url)).status()).toBe(200)
  await page.goto(url)

  await page.getByRole("button", { name: "Reserve" }).click()
  await expect(page.getByText("Reserved by you")).toBeVisible()
  await page.getByLabel("Reviewer note").fill("First saved draft.")
  await page.getByRole("button", { name: "Save draft" }).click()
  await expect(page.getByText("Saved", { exact: true })).toBeVisible()

  await delayDraftSaves(page)
  await page.getByLabel("Reviewer note").fill("Newer note that must not win.")
  await page.waitForTimeout(950)
  await page.getByRole("button", { name: "Discard draft" }).click()
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Discard draft" })
    .click()

  await expect(page.getByText("Draft discarded.")).toBeVisible({
    timeout: 10_000,
  })
  await page.reload()
  await expect(page.getByLabel("Reviewer note")).toHaveValue("")
})

test("an internal link flushes the pending draft before navigating", async ({
  page,
  request,
}) => {
  await signedInPage(page, request, "link-flush")
  const url = item("review-fixture-b", "cluster:1002:M01")
  expect((await page.request.get(url)).status()).toBe(200)
  await page.goto(url)

  await page.getByRole("button", { name: "Reserve" }).click()
  await expect(page.getByText("Reserved by you")).toBeVisible()

  await delayDraftSaves(page, 900)
  const note = "Flushed before leaving via Back to queue."
  await page.getByLabel("Reviewer note").fill(note)
  // Still inside the 800 ms debounce.
  await page.waitForTimeout(150)
  await page.getByRole("link", { name: "Back to queue" }).click()
  await expect(page).toHaveURL(/\/batches\/review-fixture-b\/queue/)

  await page.goto(url)
  await expect(page.getByLabel("Reviewer note")).toHaveValue(note)
})

test("a shell navigation link also flushes the pending draft", async ({
  page,
  request,
}) => {
  await signedInPage(page, request, "shell-flush")
  const url = item("review-fixture-b", "related:1001:o3--a3")
  expect((await page.request.get(url)).status()).toBe(200)
  await page.goto(url)

  await page.getByRole("button", { name: "Reserve" }).click()
  await expect(page.getByText("Reserved by you")).toBeVisible()

  await delayDraftSaves(page, 900)
  const note = "Flushed before leaving via the shell Queue link."
  await page.getByLabel("Reviewer note").fill(note)
  await page.waitForTimeout(150)
  await page.getByRole("link", { name: "Queue", exact: true }).click()
  await expect(page).toHaveURL(/\/batches\/review-fixture-b\/queue/)

  await page.goto(url)
  await expect(page.getByLabel("Reviewer note")).toHaveValue(note)
})

test("shortcuts cannot write a decision while a release is in flight", async ({
  page,
  request,
}) => {
  await signedInPage(page, request, "release-guard-race")
  const url = item("review-fixture-b", "agent_only:1001:a2")
  expect((await page.request.get(url)).status()).toBe(200)
  await page.goto(url)

  await page.getByRole("button", { name: "Reserve" }).click()
  await expect(page.getByText("Reserved by you")).toBeVisible()
  await page.getByLabel("Reviewer note").fill("Release guard note.")
  await delayServerActions(page)

  await page.getByRole("button", { name: "Release", exact: true }).click()
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Release claim" })
    .click()
  await expect(
    page.getByRole("heading", { name: "Release your claim?" })
  ).toHaveCount(0)

  // The release request is still on the wire and the form is suspended.
  await page.keyboard.press("s")
  await page.keyboard.press("u")
  await page.keyboard.press("3")

  await expect(page.getByText(/Claim released/)).toBeVisible({
    timeout: 10_000,
  })
  await page.reload()
  await expect(page.getByRole("button", { name: "Reserve" })).toBeVisible()
  await expect(
    page.getByText("Final decision", { exact: true })
  ).not.toBeVisible()

  // The numeric shortcut must not have selected "Invalid" while suspended.
  await page.getByRole("button", { name: "Reserve" }).click()
  await expect(page.getByText("Reserved by you")).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Confirmed valid", exact: true })
  ).toHaveAttribute("aria-pressed", "true")
  await expect(
    page.getByRole("button", { name: "Invalid", exact: true })
  ).toHaveAttribute("aria-pressed", "false")
})

test("shortcuts cannot write a decision while a discard is in flight", async ({
  page,
  request,
}) => {
  await signedInPage(page, request, "discard-guard-race")
  const url = item("review-fixture-b", "agent_only:1001:a5")
  expect((await page.request.get(url)).status()).toBe(200)
  await page.goto(url)

  await page.getByRole("button", { name: "Reserve" }).click()
  await expect(page.getByText("Reserved by you")).toBeVisible()
  await page.getByLabel("Reviewer note").fill("Draft to discard.")
  await page.getByRole("button", { name: "Save draft" }).click()
  await expect(page.getByText("Saved", { exact: true })).toBeVisible()

  await page.getByLabel("Reviewer note").fill("Must not close the item.")
  await delayServerActions(page)
  await page.getByRole("button", { name: "Discard draft" }).click()
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Discard draft" })
    .click()
  await expect(
    page.getByRole("heading", { name: "Discard this draft?" })
  ).toHaveCount(0)

  await page.keyboard.press("s")
  await page.keyboard.press("u")

  await expect(page.getByText("Draft discarded.")).toBeVisible({
    timeout: 10_000,
  })
  await page.reload()
  await expect(page.getByLabel("Reviewer note")).toHaveValue("")
  await expect(
    page.getByText("Final decision", { exact: true })
  ).not.toBeVisible()
})

test("/ and ' flush the pending draft before opening search", async ({
  page,
  request,
}) => {
  await signedInPage(page, request, "search-flush")

  const cases = [
    {
      id: "agent_only:1002:a2",
      paper: "1002",
      key: "/",
      note: "Flushed before the slash search shortcut.",
    },
    {
      id: "auditowl_only:1001:o2",
      paper: "1001",
      key: "'",
      note: "Flushed before the quote search shortcut.",
    },
  ]

  for (const entry of cases) {
    const url = item("review-fixture-b", entry.id)
    expect((await page.request.get(url)).status()).toBe(200)
    await page.goto(url)
    await page.getByRole("button", { name: "Reserve" }).click()
    await expect(page.getByText("Reserved by you")).toBeVisible()

    await delayDraftSaves(page, 900)
    await page.getByLabel("Reviewer note").fill(entry.note)
    // Move focus off the textarea so the page shortcut is allowed, then press
    // before the 800 ms autosave debounce fires.
    await page.locator("h1").click()
    await page.keyboard.press(entry.key)
    await expect(page).toHaveURL(
      new RegExp(`/batches/review-fixture-b/papers/${entry.paper}`)
    )

    await page.goto(url)
    await expect(page.getByLabel("Reviewer note")).toHaveValue(entry.note)
  }
})

test("an unknown dashboard ?batch= is not replaced by another batch", async ({
  page,
  request,
}) => {
  await signedInPage(page, request, "unknown-batch")
  await page.goto("/dashboard?batch=does-not-exist")

  await expect(
    page.getByText(/Batch “does-not-exist” is not mounted/)
  ).toBeVisible()
  await expect(page.getByRole("table")).toHaveCount(0)
  await expect(
    page.getByText("Synthetic evidence fixture", { exact: true })
  ).toHaveCount(0)

  // The header keeps the requested batch instead of falling back to a mounted
  // one, and the batch-specific Queue link is disabled rather than misleading.
  await expect(
    page.getByRole("link", { name: "Papers", exact: true })
  ).toHaveAttribute("href", "/dashboard?batch=does-not-exist")
  await expect(
    page.getByRole("link", { name: "Queue", exact: true })
  ).toHaveCount(0)
  await expect(page.getByText("Queue", { exact: true })).toBeVisible()
})

test("the workspace nav is present in the server-rendered first paint", async ({
  page,
  request,
}) => {
  await signedInPage(page, request, "ssr-nav")
  const response = await page.request.get("/batches/review-fixture-b/queue")
  expect(response.status()).toBe(200)
  const body = await response.text()

  expect(body).toContain(">Papers</a>")
  expect(body).toContain(">Queue</a>")
  expect(body).toContain(">Guide</a>")
  expect(body).toContain("/batches/review-fixture-b/queue")
})

test("unknown batches, papers and items render the not-found boundary without paths", async ({
  page,
  request,
}) => {
  await signedInPage(page, request, "unknown")
  for (const url of [
    "/batches/does-not-exist/queue",
    "/batches/review-fixture/papers/9999",
    "/batches/review-fixture/items/cluster:1001:missing",
  ]) {
    const response = await page.request.get(url)
    // A loading.tsx Suspense boundary starts the stream before the page can
    // call notFound(), so Next keeps the HTTP 200 and renders the not-found
    // boundary into the stream. What matters is that this is not the
    // data-contract error and no mount paths leak.
    expect([200, 404], url).toContain(response.status())
    const body = await response.text()
    expect(body).toMatch(/does not exist|could not be found/)
    expect(body).not.toContain("Data contract error")
    // Dev error stacks may mention the repository root; the mounted review
    // data path must never appear.
    expect(body).not.toContain(`${process.cwd()}/review-data`)
    expect(body).not.toContain(`${process.cwd()}/e2e/fixtures/review-data`)
    expect(body).not.toContain("batch.json does not match")
  }
})

test("a corrupt mounted batch renders a generic reviewer error", async ({
  page,
  request,
}) => {
  await signedInPage(page, request, "corrupt")
  const response = await page.request.get("/batches/broken-fixture/queue")
  expect(response.status()).toBe(200)
  const body = await response.text()
  expect(body).toContain("Data contract error")
  expect(body).not.toContain("Admin details")
  expect(body).not.toContain(process.cwd())
  expect(body).not.toContain("review-data/")

  // The dashboard keeps an errored batch selectable instead of dropping it.
  await page.goto("/dashboard?batch=broken-fixture")
  await expect(page.getByText("Data contract error")).toBeVisible()
  await expect(page.getByLabel("Select batch")).toContainText(
    "broken-fixture (data error)"
  )
  // Header links must keep the requested (corrupt) batch instead of silently
  // targeting a healthy batch.
  await expect(
    page.getByRole("link", { name: "Queue", exact: true })
  ).toHaveAttribute("href", "/batches/broken-fixture/queue")
  await expect(
    page.getByRole("link", { name: "Papers", exact: true })
  ).toHaveAttribute("href", "/dashboard?batch=broken-fixture")
})

test("dashboard honours ?batch= in the header, selector and links", async ({
  page,
  request,
}) => {
  await signedInPage(page, request, "two-batch")
  await page.goto("/dashboard?batch=review-fixture-b")

  await expect(page.getByLabel("Select batch")).toContainText(
    "Synthetic evidence fixture B"
  )
  const queueLink = page.getByRole("link", { name: "Queue", exact: true })
  await expect(queueLink).toHaveAttribute(
    "href",
    "/batches/review-fixture-b/queue"
  )
  await expect(
    page.getByRole("link", { name: "Papers", exact: true })
  ).toHaveAttribute("href", "/dashboard?batch=review-fixture-b")

  await queueLink.click()
  await expect(page).toHaveURL(/\/batches\/review-fixture-b\/queue/)
})

test("filters sit above the paper item list at mobile and desktop widths", async ({
  page,
  request,
}) => {
  await signedInPage(page, request, "filter-order")
  const url = "/batches/review-fixture/papers/1001"

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto(url)
    const filter = page.getByLabel("Search this paper")
    const firstItem = page
      .getByRole("link", { name: /Checkpoint selection uses the test split/ })
      .first()
    await expect(filter).toBeVisible()
    await expect(firstItem).toBeVisible()
    const filterBox = await filter.boundingBox()
    const itemBox = await firstItem.boundingBox()
    expect(filterBox).not.toBeNull()
    expect(itemBox).not.toBeNull()
    expect(filterBox!.y).toBeLessThan(itemBox!.y)
  }
})

test("navigation controls are links, not buttons", async ({
  page,
  request,
}) => {
  await signedInPage(page, request, "link-roles")

  await page.goto("/dashboard")
  await expect(page.getByRole("link", { name: "Open queue" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Open queue" })).toHaveCount(0)

  await page.goto("/batches/review-fixture/papers/1001")
  await expect(page.getByRole("link", { name: /^Open$/ }).first()).toBeVisible()
  await expect(page.getByRole("button", { name: /^Open$/ })).toHaveCount(0)

  await page.goto(item("review-fixture", "cluster:1001:M01"))
  await expect(page.getByRole("link", { name: "Back to queue" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Paper 1001" })).toBeVisible()
})
