import "dotenv/config"

import path from "node:path"

import { expect, test, type Browser, type Page } from "@playwright/test"
import Database from "better-sqlite3"

const registrationCode = process.env.REGISTRATION_CODE
const password = "correct-horse-42"

if (!registrationCode) {
  throw new Error(
    "REGISTRATION_CODE must be set in .env to run the admin review tests."
  )
}

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
}

async function createUser(page: Page, email: string) {
  const response = await page.request.post("/api/auth/sign-up/email", {
    data: {
      name: "Admin UI User",
      email,
      password,
      loginCode: registrationCode,
    },
  })
  expect(response.ok()).toBeTruthy()
}

async function newSignedInContext(browser: Browser, prefix: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const email = uniqueEmail(prefix)
  await createUser(page, email)
  return { context, page, email }
}

/**
 * The admin bootstrap command is deliberately explicit. E2E uses the same
 * resulting row to avoid shelling out while the dev server holds the database.
 */
function promoteToAdmin(email: string) {
  const db = new Database(path.join(process.cwd(), ".playwright", "test.db"))
  try {
    db.pragma("busy_timeout = 5000")
    const row = db.prepare("select id from user where email = ?").get(email)
    const userId =
      typeof row === "object" &&
      row !== null &&
      "id" in row &&
      typeof row.id === "string"
        ? row.id
        : null
    if (!userId) {
      throw new Error(`No registered user for ${email}`)
    }
    db.prepare(
      "insert into reviewer_role (user_id, role, created_at) values (?, 'admin', ?) on conflict(user_id) do update set role = 'admin'"
    ).run(userId, Date.now())
  } finally {
    db.close()
  }
}

const item = (id: string) => `/batches/review-fixture/items/${id}`

/**
 * Insert a draft row directly so the export test does not race another UI test
 * for a claim on the same fixture item. The export route reads the database;
 * the draft's origin is irrelevant to what it must exclude.
 */
function insertDraft(email: string, itemRef: string) {
  const db = new Database(path.join(process.cwd(), ".playwright", "test.db"))
  try {
    db.pragma("busy_timeout = 5000")
    const row = db.prepare("select id from user where email = ?").get(email)
    const userId =
      typeof row === "object" &&
      row !== null &&
      "id" in row &&
      typeof row.id === "string"
        ? row.id
        : null
    if (!userId) {
      throw new Error(`No registered user for ${email}`)
    }
    const now = Date.now()
    db.prepare(
      "insert into review_decision (id, batch_id, paper_id, item_kind, item_ref, user_id, status, payload, item_hash, manifest_sha256, created_at, updated_at) values (?, 'review-fixture-b', '1001', 'auditowl_only', ?, ?, 'draft', ?, ?, ?, ?, ?)"
    ).run(
      `draft-${now}-${itemRef}`,
      itemRef,
      userId,
      JSON.stringify({
        verdict: "agent_missed",
        assessment: "confirmed_valid",
        note: "This is only a draft and must never be exported as a decision.",
      }),
      "0".repeat(64),
      "0".repeat(64),
      now,
      now
    )
  } finally {
    db.close()
  }
}

async function closeItem(page: Page, id: string, note: string) {
  await page.goto(item(id))
  await page.getByRole("button", { name: "Reserve" }).click()
  await expect(page.getByText("Reserved by you")).toBeVisible()
  await page.getByLabel("Reviewer note").fill(note)
  await page.getByRole("button", { name: "Save & close" }).click()
  await expect(page.getByText(/Decision saved/)).toBeVisible()
}

/** Hold a draft autosave at the browser so release races the pending POST. */
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

test("shortcuts do nothing behind the admin release dialog", async ({
  browser,
}) => {
  const reviewer = await newSignedInContext(browser, "release-guard")
  const url = item("agent_only:1001:a5")

  try {
    await reviewer.page.goto(url)
    await reviewer.page.getByRole("button", { name: "Reserve" }).click()
    await expect(reviewer.page.getByText("Reserved by you")).toBeVisible()
    await reviewer.page.waitForTimeout(750)

    await reviewer.page
      .getByRole("button", { name: "Release", exact: true })
      .click()
    await expect(
      reviewer.page.getByRole("heading", { name: "Release your claim?" })
    ).toBeVisible()
    await reviewer.page.keyboard.press("s")
    await reviewer.page.waitForTimeout(500)

    await expect(reviewer.page.getByText("Reserved by you")).toBeVisible()
    await expect(
      reviewer.page.getByText("Final decision", { exact: true })
    ).not.toBeVisible()

    await reviewer.page.keyboard.press("Escape")
    await expect(
      reviewer.page.getByRole("heading", { name: "Release your claim?" })
    ).toHaveCount(0)
    await expect(reviewer.page.getByText("Reserved by you")).toBeVisible()
  } finally {
    await reviewer.context.close()
  }
})

test("an admin self-release is not re-claimed by a pending autosave", async ({
  browser,
}) => {
  const admin = await newSignedInContext(browser, "admin-self-release")
  const url = "/batches/review-fixture-b/items/cluster:1001:M01"
  promoteToAdmin(admin.email)

  try {
    await admin.page.goto(url)
    await admin.page.getByRole("button", { name: "Reserve" }).click()
    await expect(admin.page.getByText("Reserved by you")).toBeVisible()

    await delayDraftSaves(admin.page)
    await admin.page.getByLabel("Reviewer note").fill("Must not autosave.")
    // Release inside the 800 ms debounce window. Without suspension the timer
    // fires after the release and atomically re-claims the item.
    await admin.page.getByRole("button", { name: "Release claim" }).click()
    await admin.page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Release claim" })
      .click()

    await expect(admin.page.getByText("Claim released by admin.")).toBeVisible({
      timeout: 10_000,
    })
    await admin.page.reload()
    await expect(
      admin.page.getByRole("button", { name: "Reserve" })
    ).toBeVisible()
    await expect(admin.page.getByText("Reserved by you")).toHaveCount(0)

    // Reserve again: an empty note proves the pending autosave never landed.
    await admin.page.getByRole("button", { name: "Reserve" }).click()
    await expect(admin.page.getByText("Reserved by you")).toBeVisible()
    await expect(admin.page.getByLabel("Reviewer note")).toHaveValue("")
  } finally {
    await admin.context.close()
  }
})

test("an admin releases another reviewer's claim", async ({ browser }) => {
  const reviewer = await newSignedInContext(browser, "admin-release-holder")
  const admin = await newSignedInContext(browser, "admin-release")
  const url = item("auditowl_only:1001:o2")
  promoteToAdmin(admin.email)

  try {
    await reviewer.page.goto(url)
    await reviewer.page.getByRole("button", { name: "Reserve" }).click()
    await expect(reviewer.page.getByText("Reserved by you")).toBeVisible()

    await admin.page.goto(url)
    await expect(admin.page.getByText("Reserved by").first()).toBeVisible()
    await admin.page.getByRole("button", { name: "Release claim" }).click()
    await expect(
      admin.page.getByRole("heading", { name: "Release this claim?" })
    ).toBeVisible()
    await admin.page.keyboard.press("s")
    await admin.page.waitForTimeout(500)
    // The shortcut never saves a decision behind the alert dialog.
    await expect(
      admin.page.getByRole("heading", { name: "Release this claim?" })
    ).toBeVisible()
    await admin.page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Release claim" })
      .click()
    await expect(admin.page.getByText("Claim released by admin.")).toBeVisible()

    // The admin's own form was read-only. Releasing someone else's claim must
    // not leave it stuck on the "being updated" lock.
    await expect(
      admin.page.getByText(/claim or draft is being updated/)
    ).toHaveCount(0)
    await expect(
      admin.page.getByRole("button", { name: "Reserve" })
    ).toBeVisible()

    await admin.page.reload()
    await expect(
      admin.page.getByRole("button", { name: "Reserve" })
    ).toBeVisible()
  } finally {
    await reviewer.context.close()
    await admin.context.close()
  }
})

test("an admin reopens a closed item and the history keeps the decision", async ({
  browser,
}) => {
  const reviewer = await newSignedInContext(browser, "admin-reopen-holder")
  const admin = await newSignedInContext(browser, "admin-reopen")
  const url = item("auditowl_only:1002:o2")
  promoteToAdmin(admin.email)

  try {
    await closeItem(
      reviewer.page,
      "auditowl_only:1002:o2",
      "The caption mismatch is presentation-only."
    )

    await admin.page.goto(url)
    await expect(
      admin.page.getByText("Final decision", { exact: true })
    ).toBeVisible()
    await admin.page.getByRole("button", { name: "Reopen item" }).click()
    await expect(
      admin.page.getByRole("heading", { name: "Reopen this closed item?" })
    ).toBeVisible()
    await admin.page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Reopen item" })
      .click()
    await expect(
      admin.page.getByText("Item reopened as an admin draft.")
    ).toBeVisible()

    await admin.page.reload()
    await expect(admin.page.getByText("Reopened")).toBeVisible()
    await expect(
      admin.page.getByText("Final decision", { exact: true })
    ).not.toBeVisible()

    // Reopening releases the claim; reserve again to restore the preserved
    // draft payload in the form.
    await admin.page.getByRole("button", { name: "Reserve" }).click()
    await expect(admin.page.getByText("Reserved by you")).toBeVisible()
    await expect(admin.page.getByLabel("Reviewer note")).toHaveValue(
      "The caption mismatch is presentation-only."
    )
  } finally {
    await reviewer.context.close()
    await admin.context.close()
  }
})

test("only admins see mounted-path details for a corrupt batch", async ({
  browser,
}) => {
  const reviewer = await newSignedInContext(browser, "data-error-reviewer")
  const admin = await newSignedInContext(browser, "data-error-admin")
  promoteToAdmin(admin.email)
  const url = "/batches/broken-fixture/queue"

  try {
    const reviewerResponse = await reviewer.page.request.get(url)
    expect(reviewerResponse.status()).toBe(200)
    const reviewerBody = await reviewerResponse.text()
    expect(reviewerBody).toContain("Data contract error")
    expect(reviewerBody).not.toContain("Admin details")
    expect(reviewerBody).not.toContain("batch.json")

    const adminResponse = await admin.page.request.get(url)
    expect(adminResponse.status()).toBe(200)
    const adminBody = await adminResponse.text()
    expect(adminBody).toContain("Admin details")
    expect(adminBody).toContain("batch.json")
  } finally {
    await reviewer.context.close()
    await admin.context.close()
  }
})

test("a different reviewer sees a closed item read-only", async ({
  browser,
}) => {
  const first = await newSignedInContext(browser, "readonly-a")
  const second = await newSignedInContext(browser, "readonly-b")
  const url = item("agent_only:1002:a2")

  try {
    await closeItem(
      first.page,
      "agent_only:1002:a2",
      "The ablation really is missing."
    )

    await second.page.goto(url)
    await expect(
      second.page.getByText("Final decision", { exact: true })
    ).toBeVisible()
    await expect(
      second.page.getByText("The ablation really is missing.").first()
    ).toBeVisible()
    await expect(
      second.page.getByRole("button", { name: "Save & close" })
    ).toHaveCount(0)
    await expect(
      second.page.getByRole("button", { name: "Save & next" })
    ).toHaveCount(0)
    await expect(
      second.page.getByRole("button", { name: "Reserve" })
    ).toHaveCount(0)
  } finally {
    await first.context.close()
    await second.context.close()
  }
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function rowsOf(value: unknown, key: string): Record<string, unknown>[] {
  if (!isRecord(value) || !Array.isArray(value[key])) {
    throw new Error(`export response has no ${key} array`)
  }
  return value[key].filter(isRecord)
}

test("the admin page is blocked for reviewers and shows every admin surface", async ({
  browser,
}) => {
  const reviewer = await newSignedInContext(browser, "admin-page-reviewer")
  const admin = await newSignedInContext(browser, "admin-page")
  promoteToAdmin(admin.email)
  const note = "Admin queue fixture note."

  try {
    const claimUrl = "/batches/review-fixture/items/auditowl_only:1001:o3"
    await reviewer.page.goto(claimUrl)
    await reviewer.page.getByRole("button", { name: "Reserve" }).click()
    await expect(reviewer.page.getByText("Reserved by you")).toBeVisible()

    const unsureUrl = "/batches/review-fixture-b/items/auditowl_only:1001:o3"
    await reviewer.page.goto(unsureUrl)
    await reviewer.page.getByRole("button", { name: "Reserve" }).click()
    await expect(reviewer.page.getByText("Reserved by you")).toBeVisible()
    await reviewer.page.getByLabel("Reviewer note").fill(note)
    await reviewer.page
      .getByRole("button", { name: "Mark unsure and release the claim" })
      .click()
    await expect(reviewer.page.getByText(/Marked unsure/)).toBeVisible()

    const blocked = await reviewer.page.request.get("/admin")
    const blockedBody = await blocked.text()
    expect(blockedBody).not.toContain("Batch statistics")
    expect(blockedBody).not.toContain("Data health")
    await reviewer.page.goto("/dashboard")
    await expect(
      reviewer.page.getByRole("link", { name: "Admin", exact: true })
    ).toHaveCount(0)

    await admin.page.goto("/admin")
    await expect(
      admin.page.getByRole("heading", { name: "Admin", level: 1 })
    ).toBeVisible()
    await expect(
      admin.page.getByRole("link", { name: "Admin", exact: true })
    ).toBeVisible()
    await expect(
      admin.page.getByText("Data health", { exact: true })
    ).toBeVisible()
    await expect(
      admin.page.getByText("Batch statistics", { exact: true })
    ).toBeVisible()
    await expect(
      admin.page.getByText("Paper statistics", { exact: true })
    ).toBeVisible()
    await expect(
      admin.page.getByText("Active claims", { exact: true })
    ).toBeVisible()
    await expect(
      admin.page.getByText("Unsure queue", { exact: true })
    ).toBeVisible()
    await expect(admin.page.getByText("Exports", { exact: true })).toBeVisible()
    await expect(
      admin.page.getByRole("cell", { name: admin.email }).first()
    ).toBeVisible()
    await expect(
      admin.page.getByRole("link", { name: "Dataset JSON" }).first()
    ).toHaveAttribute(
      "href",
      /\/api\/admin\/export\/review-fixture(-b)?\?type=dataset/
    )
    await expect(
      admin.page.getByRole("link", { name: "Decisions JSON" }).first()
    ).toHaveAttribute(
      "href",
      /\/api\/admin\/export\/review-fixture(-b)?\?type=decisions/
    )
    await expect(
      admin.page.getByText("Seeding is inconsistent across runs").first()
    ).toBeVisible()
    await expect(admin.page.getByText(note).first()).toBeVisible()

    await admin.page.getByRole("button", { name: "Reload data" }).click()
    await expect(
      admin.page.getByText("Review data cache cleared.")
    ).toBeVisible()
  } finally {
    await reviewer.context.close()
    await admin.context.close()
  }
})

test("an admin promotes and demotes another user from the admin page", async ({
  browser,
}) => {
  const reviewer = await newSignedInContext(browser, "admin-role-target")
  const admin = await newSignedInContext(browser, "admin-role")
  promoteToAdmin(admin.email)

  try {
    await admin.page.goto("/admin")
    const row = admin.page
      .getByRole("row")
      .filter({ hasText: reviewer.email })
      .first()
    await expect(row.getByText("reviewer", { exact: true })).toBeVisible()

    await row.getByRole("button", { name: "Promote" }).click()
    await expect(admin.page.getByText("User promoted to admin.")).toBeVisible()
    await expect(row.getByText("admin", { exact: true })).toBeVisible()

    await row.getByRole("button", { name: "Demote" }).click()
    await expect(admin.page.getByText("User demoted.")).toBeVisible()
    await expect(row.getByText("reviewer", { exact: true })).toBeVisible()
  } finally {
    await reviewer.context.close()
    await admin.context.close()
  }
})

test("an admin releases a reviewer claim from the admin page", async ({
  browser,
}) => {
  const reviewer = await newSignedInContext(browser, "admin-claim-holder")
  const admin = await newSignedInContext(browser, "admin-claim-page")
  promoteToAdmin(admin.email)
  const url = "/batches/review-fixture-b/items/agent_only:1003:a1"

  try {
    await reviewer.page.goto(url)
    await reviewer.page.getByRole("button", { name: "Reserve" }).click()
    await expect(reviewer.page.getByText("Reserved by you")).toBeVisible()

    await admin.page.goto("/admin")
    const row = admin.page
      .getByRole("row")
      .filter({ hasText: "Admin claim release target" })
      .first()
    await expect(row).toBeVisible()
    await row.getByRole("button", { name: "Release", exact: true }).click()
    await expect(admin.page.getByText("Claim released by admin.")).toBeVisible()
    await expect(row).toHaveCount(0)

    await reviewer.page.reload()
    await expect(
      reviewer.page.getByRole("button", { name: "Reserve" })
    ).toBeVisible()
  } finally {
    await reviewer.context.close()
    await admin.context.close()
  }
})

test("admin exports contain closed decisions but never drafts", async ({
  browser,
  request,
}) => {
  const reviewer = await newSignedInContext(browser, "export-reviewer")
  const admin = await newSignedInContext(browser, "export-admin")
  promoteToAdmin(admin.email)

  try {
    insertDraft(reviewer.email, "o2")

    const closedUrl = "/batches/review-fixture-b/items/auditowl_only:1002:o2"
    await reviewer.page.goto(closedUrl)
    await reviewer.page.getByRole("button", { name: "Reserve" }).click()
    await expect(reviewer.page.getByText("Reserved by you")).toBeVisible()
    await reviewer.page
      .getByLabel("Reviewer note")
      .fill("Final export fixture decision.")
    await reviewer.page.getByRole("button", { name: "Save & close" }).click()
    await expect(reviewer.page.getByText(/Decision saved/)).toBeVisible()

    const anonymous = await request.get(
      "/api/admin/export/review-fixture-b?type=decisions"
    )
    expect(anonymous.status()).toBe(401)

    const forbidden = await reviewer.page.request.get(
      "/api/admin/export/review-fixture-b?type=decisions"
    )
    expect(forbidden.status()).toBe(403)

    const decisionsResponse = await admin.page.request.get(
      "/api/admin/export/review-fixture-b?type=decisions"
    )
    expect(decisionsResponse.status()).toBe(200)
    expect(decisionsResponse.headers()["content-disposition"]).toContain(
      "attachment"
    )
    expect(decisionsResponse.headers()["content-type"]).toContain(
      "application/json"
    )
    expect(decisionsResponse.headers()["x-content-type-options"]).toBe(
      "nosniff"
    )
    const decisionsBody: unknown = await decisionsResponse.json()
    const finalRows = rowsOf(decisionsBody, "decisions")
    expect(
      finalRows.some((row) => row.paperId === "1002" && row.itemRef === "o2")
    ).toBe(true)
    expect(
      finalRows.some(
        (row) =>
          row.paperId === "1001" &&
          row.itemKind === "auditowl_only" &&
          row.itemRef === "o2"
      )
    ).toBe(false)

    const datasetResponse = await admin.page.request.get(
      "/api/admin/export/review-fixture-b?type=dataset"
    )
    expect(datasetResponse.status()).toBe(200)
    expect(datasetResponse.headers()["content-type"]).toContain(
      "application/json"
    )
    expect(datasetResponse.headers()["content-disposition"]).toContain(
      "attachment"
    )
    expect(datasetResponse.headers()["x-content-type-options"]).toBe("nosniff")
    const datasetBody: unknown = await datasetResponse.json()
    expect(
      rowsOf(datasetBody, "decisions").some(
        (row) =>
          row.paperId === "1001" &&
          row.itemKind === "auditowl_only" &&
          row.itemRef === "o2" &&
          row.status === "draft"
      )
    ).toBe(true)

    const invalidType = await admin.page.request.get(
      "/api/admin/export/review-fixture-b?type=both"
    )
    expect(invalidType.status()).toBe(400)
    const unknownType = await admin.page.request.get(
      "/api/admin/export/review-fixture-b?type=../../etc/passwd"
    )
    expect(unknownType.status()).toBe(400)
    const traversal = await admin.page.request.get(
      "/api/admin/export/..%2F..%2Fetc?type=dataset"
    )
    expect([400, 404]).toContain(traversal.status())
    expect(await traversal.text()).not.toContain("root:x:")
  } finally {
    await reviewer.context.close()
    await admin.context.close()
  }
})
