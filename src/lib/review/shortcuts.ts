export interface ShortcutDefinition {
  keys: string
  action: string
}

export const SHORTCUTS: readonly ShortcutDefinition[] = [
  { keys: "j / k", action: "Next / previous item" },
  { keys: "1–5", action: "Choose the primary verdict for this item type" },
  {
    keys: "s",
    action: "Save and close, or save a draft when the form is incomplete",
  },
  { keys: "u", action: "Mark unsure and release the claim" },
  { keys: "r", action: "Release the claim without a decision" },
  { keys: "e", action: "Jump to the evidence panel" },
  { keys: "/", action: "Focus the search field" },
  { keys: "?", action: "Open this shortcut help" },
  { keys: "d", action: "Toggle the colour theme" },
]

/**
 * Base UI popups (and cmdk/dialog overlays) expose `data-open` while mounted.
 * The role selectors cover alert dialogs, menus, listboxes and any dialog that
 * does not use the generated data slot. A keyboard shortcut must never act on
 * the page behind one of these.
 */
export const OPEN_OVERLAY_SELECTOR = [
  // Base UI marks an open popup with `data-open`; the content slot is a
  // fallback for browsers/paths where that attribute is not observable.
  "[data-slot='dialog-content'][data-open]",
  "[data-slot='alert-dialog-content'][data-open]",
  "[data-slot='popover-content'][data-open]",
  "[data-slot='select-content'][data-open]",
  "[data-slot='dropdown-menu-content'][data-open]",
  "[data-slot='command'][data-open]",
  "[role='dialog'][data-open]",
  "[role='alertdialog'][data-open]",
  "[role='menu'][data-open]",
  "[role='listbox'][data-open]",
  "[data-slot='dialog-content']",
  "[data-slot='alert-dialog-content']",
  "[data-slot='command']",
  "dialog[open]",
  "[role='dialog'][aria-modal='true']",
  "[role='alertdialog']",
  "[aria-modal='true']",
].join(",")

/** A text input, textarea, select or contenteditable owns the keyboard. */
export function isTypingTarget(target: unknown): boolean {
  if (typeof target !== "object" || target === null) {
    return false
  }
  const tagName =
    "tagName" in target && typeof target.tagName === "string"
      ? target.tagName
      : ""
  return (
    ("isContentEditable" in target && target.isContentEditable === true) ||
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT"
  )
}

export function hasOpenOverlay(query: (selector: string) => unknown): boolean {
  return query(OPEN_OVERLAY_SELECTOR) !== null
}

export interface ShortcutEventLike {
  defaultPrevented?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  target?: unknown
}

/**
 * One guard for every keyboard layer (item actions, the shared search/help
 * layer and the theme hotkey).
 */
export function isShortcutSuppressed(
  event: ShortcutEventLike,
  query: (selector: string) => unknown = (selector) =>
    document.querySelector(selector)
): boolean {
  return (
    event.defaultPrevented === true ||
    event.metaKey === true ||
    event.ctrlKey === true ||
    event.altKey === true ||
    isTypingTarget(event.target) ||
    hasOpenOverlay(query)
  )
}

/** Firefox quick-find/browser find keys that the app turns into search. */
export function isSearchKey(key: string): boolean {
  return key === "/" || key === "'"
}
