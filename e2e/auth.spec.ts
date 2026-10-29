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

async function fillSignUpForm(
  page: Page,
  email: string,
  loginCode: string,
  profile: { association?: string; title?: string } = {}
) {
  await page.goto("/sign-up")
  await page.getByLabel("Name").fill("Test User")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  if (profile.association) {
    await page.getByLabel("Association").fill(profile.association)
  }
  if (profile.title) {
    await page.getByLabel("Title").fill(profile.title)
  }
  await page.getByLabel("Registration code").fill(loginCode)
}

async function currentUser(page: Page) {
  const response = await page.request.get("/api/auth/get-session")
  const session = await response.json()

  return session?.user ?? null
}

test("rejects sign-up with a wrong registration code", async ({ page }) => {
  const email = uniqueEmail()

  await fillSignUpForm(page, email, "not-the-code")
  await page.getByRole("button", { name: "Create account" }).click()

  await expect(
    page.getByRole("alert").filter({ hasText: "Invalid registration code" })
  ).toBeVisible()
  await expect(page).toHaveURL(/\/sign-up$/)
  expect(await currentUser(page)).toBeNull()
})

test("rejects sign-up without a registration code", async ({ page }) => {
  const email = uniqueEmail()

  await fillSignUpForm(page, email, "")
  await page.getByRole("button", { name: "Create account" }).click()

  await expect(
    page.getByRole("alert").filter({ hasText: "Invalid registration code" })
  ).toBeVisible()
  await expect(page).toHaveURL(/\/sign-up$/)
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

test("registers with the correct code and stores profile fields", async ({
  page,
}) => {
  const email = uniqueEmail()

  await fillSignUpForm(page, email, registrationCode, {
    association: "Chair of Software Engineering",
    title: "M.Sc.",
  })
  await page.getByRole("button", { name: "Create account" }).click()

  await expect(page).toHaveURL("/")
  expect(await currentUser(page)).toMatchObject({
    email,
    association: "Chair of Software Engineering",
    title: "M.Sc.",
  })
})

test("signs in with valid credentials", async ({ page, request }) => {
  const email = uniqueEmail()

  await createUser(request, email)

  await page.goto("/sign-in")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Sign in" }).click()

  await expect(page).toHaveURL("/")
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
