import "dotenv/config"

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test"

const registrationCode = process.env.REGISTRATION_CODE
const contactEmail = process.env.CONTACT_EMAIL
const password = "correct-horse-42"
const tourPopover = '[data-slot="tour-popover"]'

if (!registrationCode) {
  throw new Error(
    "REGISTRATION_CODE must be set in .env to run the guide UI tests."
  )
}

if (!contactEmail) {
  throw new Error(
    "CONTACT_EMAIL must be set in .env to run the guide UI tests."
  )
}

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
}

async function createUser(request: APIRequestContext, email: string) {
  const response = await request.post("/api/auth/sign-up/email", {
    data: {
      name: "Guide UI User",
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
  prefix = "guide"
) {
  const email = uniqueEmail(prefix)
  await createUser(request, email)
  // Sign in through the browser context so the page gets the session cookie.
  const response = await page.request.post("/api/auth/sign-in/email", {
    data: { email, password },
  })
  if (!response.ok()) {
    throw new Error(
      `sign-in failed with ${response.status()}: ${await response.text()}`
    )
  }
  return email
}

test("the guide speaks in the maintainer's voice and keeps the protocol", async ({
  page,
  request,
}) => {
  await signedInPage(page, request)
  await page.goto("/guide")

  await expect(
    page.getByRole("link", { name: contactEmail }).first()
  ).toBeVisible()
  await expect(page.getByText("Claim and lease")).toBeVisible()
  await expect(page.getByText("Proposed link")).toBeVisible()
})

test("the inline guide tour advances and finishes without a URL parameter", async ({
  page,
  request,
}) => {
  await signedInPage(page, request, "guide-tour")
  await page.goto("/guide")

  await page
    .getByRole("button", { name: "Start the guide tour" })
    .first()
    .click()
  await expect(page.locator(tourPopover)).toBeVisible()
  await expect(page.getByText(/Step 1 of \d+/)).toBeVisible()

  await page.getByRole("button", { name: "Next", exact: true }).click()
  await expect(page.getByText(/Step 2 of \d+/)).toBeVisible()

  const next = page.getByRole("button", { name: "Next", exact: true })
  const done = page.getByRole("button", { name: "Done", exact: true })
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await done.isVisible().catch(() => false)) {
      break
    }
    if (!(await next.isVisible().catch(() => false))) {
      break
    }
    await next.click()
  }
  await expect(done).toBeVisible()
  await done.click()
  await expect(page.locator(tourPopover)).toHaveCount(0)
  await expect(page).not.toHaveURL(/[?&]tour=/)
})

test("the paper tour card links to the example paper and starts its tour", async ({
  page,
  request,
}) => {
  await signedInPage(page, request, "guide-paper")
  await page.goto("/guide")

  const paperTour = page.getByRole("link", { name: "Start the paper tour" })
  await expect(paperTour).toHaveAttribute(
    "href",
    "/batches/review-fixture/papers/1001?tour=paper"
  )
  expect(await paperTour.evaluate((element) => element.tagName)).toBe("A")
  await paperTour.click()

  await expect(page.locator(tourPopover)).toBeVisible()
  await expect(page).toHaveURL(/\/batches\/review-fixture\/papers\/1001$/)
  await page.keyboard.press("Escape")
  await expect(page.locator(tourPopover)).toHaveCount(0)
  await expect(page).not.toHaveURL(/[?&]tour=/)
})

test("the guide links the paper and item tours to the example", async ({
  page,
  request,
}) => {
  await signedInPage(page, request, "guide-example")
  await page.goto("/guide")

  await expect(
    page.getByRole("link", { name: "Start the paper tour" })
  ).toHaveAttribute("href", "/batches/review-fixture/papers/1001?tour=paper")
  await expect(
    page.getByRole("link", { name: "Start the review item tour" })
  ).toHaveAttribute(
    "href",
    "/batches/review-fixture/items/cluster:1001:M01?tour=item"
  )
})

test("tours started from the guide include the whole page tour", async ({
  page,
  request,
}) => {
  await signedInPage(page, request, "guide-full")
  const cases = [
    { link: "Start the dashboard tour", minSteps: 6 },
    { link: "Start the paper tour", minSteps: 4 },
    { link: "Start the review item tour", minSteps: 6 },
  ]

  for (const entry of cases) {
    await page.goto("/guide")
    await page.getByRole("link", { name: entry.link }).click()
    await expect(page.locator(tourPopover)).toBeVisible()

    const counter = page.getByText(/^Step 1 of \d+$/)
    await expect(counter).toBeVisible()
    const text = (await counter.textContent()) ?? ""
    const total = Number(text.match(/of (\d+)/)?.[1])
    expect(total).toBeGreaterThanOrEqual(entry.minSteps)

    await page.keyboard.press("Escape")
    await expect(page.locator(tourPopover)).toHaveCount(0)
  }
})

test("a tour moves focus to its close button", async ({ page, request }) => {
  await signedInPage(page, request, "guide-focus")
  await page.goto("/dashboard")

  await page.getByRole("button", { name: "Start the dashboard tour" }).click()
  await expect(page.locator(tourPopover)).toBeVisible()
  await expect(page.getByRole("button", { name: "Close tour" })).toBeFocused()
  // The virtual anchor leaves the decorative arrow detached at a corner.
  await expect(page.locator('[data-slot="tour-popover-arrow"]')).toBeHidden()
  await expect(page.locator("[data-app-root]")).toHaveAttribute("inert", "")

  await page.keyboard.press("Escape")
  await expect(page.locator(tourPopover)).toHaveCount(0)
  await expect(page.locator("[data-app-root]")).not.toHaveAttribute("inert", "")
})

test("a tour parameter for another page is stripped without starting", async ({
  page,
  request,
}) => {
  await signedInPage(page, request, "guide-wrong-page")
  await page.goto("/dashboard?tour=paper")

  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.locator(tourPopover)).toHaveCount(0)
})

test("a dashboard tour starts from the URL, strips it, and does not replay", async ({
  page,
  request,
}) => {
  await signedInPage(page, request, "guide-dashboard")
  await page.goto("/dashboard?tour=dashboard")

  await expect(page.locator(tourPopover)).toBeVisible()
  await expect(page).toHaveURL(/\/dashboard$/)
  await page.keyboard.press("Escape")
  await expect(page.locator(tourPopover)).toHaveCount(0)

  await page.reload()
  await expect(
    page.getByRole("heading", { name: /Welcome back/ })
  ).toBeVisible()
  await page.waitForTimeout(750)
  await expect(page.locator(tourPopover)).toHaveCount(0)
})

test("an item tour suppresses page shortcuts until it closes", async ({
  page,
  request,
}) => {
  await signedInPage(page, request, "guide-item")
  const url = "/batches/review-fixture/items/cluster:1002:M01"
  await page.goto(url)
  await expect(page.getByText("Automated comparator").first()).toBeVisible()
  // Let the client shortcut listener hydrate before pressing a shortcut.
  await page.waitForTimeout(750)

  await page.getByRole("button", { name: "Start the review item tour" }).click()
  await expect(page.locator(tourPopover)).toBeVisible()

  await page.keyboard.press("j")
  await page.waitForTimeout(500)
  await expect(page).toHaveURL(url)

  await page.keyboard.press("?")
  await expect(
    page.getByRole("heading", { name: "Keyboard shortcuts" })
  ).toHaveCount(0)

  await page.keyboard.press("Escape")
  await expect(page.locator(tourPopover)).toHaveCount(0)

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

test("every reviewer page exposes its own tour button", async ({
  page,
  request,
}) => {
  await signedInPage(page, request, "guide-smoke")
  const pages = [
    { url: "/guide", name: "Start the guide tour" },
    { url: "/dashboard", name: "Start the dashboard tour" },
    {
      url: "/batches/review-fixture/papers/1001",
      name: "Start the paper tour",
    },
    {
      url: "/batches/review-fixture/items/cluster:1001:M01",
      name: "Start the review item tour",
    },
  ]

  let color: string | null = null
  for (const entry of pages) {
    await page.goto(entry.url)
    const trigger = page.getByRole("button", { name: entry.name }).first()
    await expect(trigger).toBeVisible()

    // The trigger sits inside muted toolbars on some pages; it must still use
    // the same foreground color as the dashboard one.
    const current = await trigger.evaluate(
      (element) => getComputedStyle(element).color
    )
    color ??= current
    expect(current).toBe(color)
  }
})
