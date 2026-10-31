import { expect, type Page } from "@playwright/test"

/** Open the decision popover from the claim bar. */
export async function openDecisionForm(page: Page) {
  await page.getByRole("button", { name: "Your decision" }).click()
  await expect(page.getByLabel("Reviewer note")).toBeVisible()
}

/** Reserve the item, then open the decision popover. */
export async function reserveAndOpenDecision(page: Page) {
  await page.getByRole("button", { name: "Reserve" }).click()
  await expect(page.getByText("Reserved by you")).toBeVisible()
  await openDecisionForm(page)
}

/** Close the decision popover; the mounted form keeps its pending autosave. */
export async function closeDecisionForm(page: Page) {
  await page.keyboard.press("Escape")
  await expect(page.getByLabel("Reviewer note")).not.toBeVisible()
}

/** Open the read-only final decision details from the closed claim bar. */
export async function openFinalDecisionDetails(page: Page) {
  await page.getByRole("button", { name: "Details", exact: true }).click()
  const details = page.getByRole("dialog", { name: "Final decision" })
  await expect(details).toBeVisible()
  return details
}
