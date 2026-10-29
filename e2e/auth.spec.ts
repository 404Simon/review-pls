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
    "REGISTRATION_CODE must be set in .env to run the auth tests."
  )
}

function uniqueEmail() {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
}

function signUpPayload(email: string, loginCode?: string) {
  return {
    name: "Test User",
    email,
    password,
    ...(loginCode ? { loginCode } : {}),
  }
}

async function createUser(request: APIRequestContext, email: string) {
  const response = await request.post("/api/auth/sign-up/email", {
    data: signUpPayload(email, registrationCode),
  })

  expect(response.ok()).toBeTruthy()
}

async function startSignUp(page: Page, loginCode: string) {
  await page.goto("/sign-up")
  await page.getByLabel("Registration code").fill(loginCode)
  await page.getByRole("button", { name: "Continue" }).click()
}

async function completeAccountStep(page: Page, email: string) {
  await page.getByLabel("First name").fill("Test")
  await page.getByLabel("Last name").fill("User")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Continue" }).click()

  await expect(page.getByText("Step 3 of 3")).toBeVisible()
}

async function currentUser(page: Page) {
  const response = await page.request.get("/api/auth/get-session")
  const session = await response.json()

  return session?.user ?? null
}

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Sign in" }).click()

  await expect(page).toHaveURL("/dashboard")
}

test("rejects sign-up with a wrong registration code", async ({ page }) => {
  await startSignUp(page, "not-the-code")

  await expect(
    page.getByRole("alert").filter({ hasText: "Invalid registration code" })
  ).toBeVisible()
  await expect(page).toHaveURL(/\/sign-up$/)
  await expect(page.getByText("Step 1 of 3")).toBeVisible()
  expect(await currentUser(page)).toBeNull()
})

test("does not continue without a registration code", async ({ page }) => {
  await page.goto("/sign-up")
  await page.getByRole("button", { name: "Continue" }).click()

  await expect(page).toHaveURL(/\/sign-up$/)
  await expect(page.getByText("Step 1 of 3")).toBeVisible()
  await expect(page.getByLabel("First name")).toHaveCount(0)
  expect(await currentUser(page)).toBeNull()
})

test("registration endpoint rejects a missing code", async ({ request }) => {
  const response = await request.post("/api/auth/sign-up/email", {
    data: signUpPayload(uniqueEmail()),
  })

  expect(response.status()).toBe(400)
  expect(await response.json()).toEqual({
    message: "Invalid registration code",
  })
})

test("verification endpoint accepts the correct code", async ({ request }) => {
  const response = await request.post("/api/registration-code", {
    data: { code: registrationCode },
    headers: { "x-forwarded-for": "203.0.113.10" },
  })

  expect(response.status()).toBe(200)
  expect(await response.json()).toEqual({ ok: true })
})

test("verification endpoint rejects a wrong code", async ({ request }) => {
  const response = await request.post("/api/registration-code", {
    data: { code: "definitely-not-the-code" },
    headers: { "x-forwarded-for": "203.0.113.11" },
  })

  expect(response.status()).toBe(400)
  expect(await response.json()).toEqual({
    message: "Invalid registration code",
  })
})

test("verification endpoint rate limits repeated wrong codes", async ({
  request,
}) => {
  const headers = { "x-forwarded-for": "203.0.113.12" }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await request.post("/api/registration-code", {
      data: { code: "wrong" },
      headers,
    })

    expect(response.status()).toBe(400)
  }

  const blocked = await request.post("/api/registration-code", {
    data: { code: "wrong" },
    headers,
  })

  expect(blocked.status()).toBe(429)
  expect(blocked.headers()["retry-after"]).toBeTruthy()
})

test("registers with the correct code and stores profile fields", async ({
  page,
}) => {
  const email = uniqueEmail()

  await startSignUp(page, registrationCode)
  await expect(page.getByLabel("First name")).toBeVisible()
  await completeAccountStep(page, email)
  await page.getByLabel("Association").fill("Chair of Software Engineering")
  await page.getByLabel("Title").fill("M.Sc.")
  await page.getByRole("button", { name: "Create account" }).click()

  await expect(page).toHaveURL("/dashboard")
  await expect(
    page.getByRole("heading", { name: /Welcome back/ })
  ).toBeVisible()
  expect(await currentUser(page)).toMatchObject({
    name: "Test User",
    email,
    association: "Chair of Software Engineering",
    title: "M.Sc.",
  })
})

test("keeps typed profile values when navigating back to change the email", async ({
  page,
}) => {
  const email = uniqueEmail()
  const updatedEmail = uniqueEmail()

  await startSignUp(page, registrationCode)
  await expect(page.getByLabel("First name")).toBeVisible()
  await completeAccountStep(page, email)

  await page.getByLabel("Association").fill("Chair of Software Engineering")
  await page.getByLabel("Title").fill("M.Sc.")

  await page.getByRole("button", { name: "Back" }).click()
  await page.getByLabel("Email").fill(updatedEmail)
  await page.getByRole("button", { name: "Continue" }).click()

  await expect(page.getByLabel("Association")).toHaveValue(
    "Chair of Software Engineering"
  )
  await expect(page.getByLabel("Title")).toHaveValue("M.Sc.")

  await page.getByRole("button", { name: "Create account" }).click()

  await expect(page).toHaveURL("/dashboard")
  expect(await currentUser(page)).toMatchObject({
    email: updatedEmail,
    association: "Chair of Software Engineering",
    title: "M.Sc.",
  })
})

test("signs in with valid credentials", async ({ page, request }) => {
  const email = uniqueEmail()

  await createUser(request, email)
  await signIn(page, email)

  expect(await currentUser(page)).toMatchObject({
    email,
    association: "none",
    title: "none",
  })
})

test("rejects sign-in with a wrong password", async ({ page, request }) => {
  const email = uniqueEmail()

  await createUser(request, email)

  await page.goto("/sign-in")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill("wrong-password")
  await page.getByRole("button", { name: "Sign in" }).click()

  await expect(
    page.getByRole("alert").filter({ hasText: "Sign in failed" })
  ).toBeVisible()
  await expect(page).toHaveURL(/\/sign-in$/)
  expect(await currentUser(page)).toBeNull()
})

test("sends signed-out visitors to the sign-in page", async ({ page }) => {
  await page.goto("/")
  await expect(page).toHaveURL("/sign-in")
})

test("protects the dashboard from signed-out visitors", async ({ page }) => {
  await page.goto("/dashboard")
  await expect(page).toHaveURL("/sign-in")
})

test("sends signed-in users to the dashboard", async ({ page, request }) => {
  const email = uniqueEmail()

  await createUser(request, email)
  await signIn(page, email)

  await page.goto("/")
  await expect(page).toHaveURL("/dashboard")

  await page.goto("/sign-in")
  await expect(page).toHaveURL("/dashboard")

  await page.goto("/sign-up")
  await expect(page).toHaveURL("/dashboard")
})

test("signs out and returns to the sign-in page", async ({ page, request }) => {
  const email = uniqueEmail()

  await createUser(request, email)
  await signIn(page, email)

  await page.getByRole("button", { name: "Sign out" }).click()

  await expect(page).toHaveURL("/sign-in")
  expect(await currentUser(page)).toBeNull()
})
