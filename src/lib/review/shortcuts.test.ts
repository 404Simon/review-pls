import { describe, expect, it } from "vitest"

import {
  hasOpenOverlay,
  isSearchKey,
  isShortcutSuppressed,
  isTypingTarget,
  OPEN_OVERLAY_SELECTOR,
  SHORTCUTS,
} from "@/lib/review/shortcuts"

describe("shortcut definitions", () => {
  it("documents every item-page shortcut", () => {
    const keys = SHORTCUTS.map((shortcut) => shortcut.keys)
    expect(keys).toEqual(["j / k", "1–5", "s", "u", "r", "e", "/", "?", "d"])
  })
})

describe("isTypingTarget", () => {
  it("recognises inputs, textareas, selects and contenteditable", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
      expect(isTypingTarget({ tagName })).toBe(true)
    }
    expect(isTypingTarget({ isContentEditable: true })).toBe(true)
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
    expect(isTypingTarget("input")).toBe(false)
  })
})

describe("overlay guard", () => {
  it("detects an open popup through the shared selector", () => {
    const selectors: string[] = []
    expect(
      hasOpenOverlay((selector) => {
        selectors.push(selector)
        return null
      })
    ).toBe(false)
    expect(selectors).toEqual([OPEN_OVERLAY_SELECTOR])

    expect(hasOpenOverlay(() => ({}))).toBe(true)
    expect(OPEN_OVERLAY_SELECTOR).toContain("data-open")
    expect(OPEN_OVERLAY_SELECTOR).toContain("[role='alertdialog']")
  })

  it("suppresses shortcuts behind dialogs, in fields and with modifiers", () => {
    expect(
      isShortcutSuppressed({ target: { tagName: "TEXTAREA" } }, () => null)
    ).toBe(true)
    expect(isShortcutSuppressed({ metaKey: true }, () => null)).toBe(true)
    expect(isShortcutSuppressed({ ctrlKey: true }, () => null)).toBe(true)
    expect(isShortcutSuppressed({ altKey: true }, () => null)).toBe(true)
    expect(isShortcutSuppressed({ defaultPrevented: true }, () => null)).toBe(
      true
    )
    expect(
      isShortcutSuppressed({ target: { tagName: "BUTTON" } }, () => ({}))
    ).toBe(true)
    expect(
      isShortcutSuppressed({ target: { tagName: "BUTTON" } }, () => null)
    ).toBe(false)
  })
})

describe("search keys", () => {
  it("reserves slash and apostrophe for search (Firefox quick-find)", () => {
    expect(isSearchKey("/")).toBe(true)
    expect(isSearchKey("'")).toBe(true)
    expect(isSearchKey("?")).toBe(false)
  })
})
