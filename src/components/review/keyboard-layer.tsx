"use client"

import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"

import { ShortcutHelp } from "@/components/review/shortcut-help"
import { isSearchKey, isShortcutSuppressed } from "@/lib/review/shortcuts"

/**
 * Shared `/` and `?` shortcuts for dashboard, queue and paper pages. The item
 * page installs its own richer handler, so this layer deliberately stands down
 * there to avoid opening two help dialogs or stealing the item search shortcut.
 */
export function KeyboardLayer() {
  const pathname = usePathname()
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isShortcutSuppressed(event)) {
        return
      }
      if (pathname.includes("/items/")) {
        return
      }
      if (isSearchKey(event.key)) {
        event.preventDefault()
        const search = document.querySelector<HTMLInputElement>(
          "[data-review-search]"
        )
        if (search) {
          search.focus()
          search.select()
        }
        return
      }
      if (event.key === "?") {
        event.preventDefault()
        setHelpOpen(true)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [pathname])

  return <ShortcutHelp open={helpOpen} onOpenChange={setHelpOpen} />
}
