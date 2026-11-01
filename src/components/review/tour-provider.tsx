"use client"

import { useEffect, useState } from "react"

import { TourProvider, useTour } from "@/components/ui/tour"

const APP_ROOT_SELECTOR = "[data-app-root]"
const CLOSE_BUTTON_SELECTOR =
  '[data-slot="tour-popover"] [aria-label="Close tour"]'
const FOCUS_ATTEMPTS = 20

/**
 * `interactive={false}` blocks pointer input but does not move focus. While a
 * tour is open, make the page behind it inert and put keyboard focus on the
 * tour close button, so tabbing cannot reach review controls. The page is
 * restored when the tour ends.
 */
function TourFocusGuard() {
  const { active } = useTour()

  useEffect(() => {
    if (!active) {
      return
    }

    const appRoot = document.querySelector<HTMLElement>(APP_ROOT_SELECTOR)
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null

    appRoot?.setAttribute("inert", "")

    let frame = 0
    let attempt = 0
    const focusCloseButton = () => {
      const closeButton = document.querySelector<HTMLElement>(
        CLOSE_BUTTON_SELECTOR
      )
      if (closeButton) {
        closeButton.focus()
        return
      }
      if (attempt < FOCUS_ATTEMPTS) {
        attempt += 1
        frame = window.requestAnimationFrame(focusCloseButton)
      }
    }
    frame = window.requestAnimationFrame(focusCloseButton)

    return () => {
      window.cancelAnimationFrame(frame)
      appRoot?.removeAttribute("inert")
      if (previous?.isConnected) {
        previous.focus()
      }
    }
  }, [active])

  return null
}

/**
 * App-wide tour state. The wrapper keeps the product defaults in one place and
 * disables clicking through the spotlight, so a tour can never change review
 * data by accident.
 */
export function ReviewTourProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setReducedMotion(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])

  return (
    <TourProvider
      interactive={false}
      overlayClick="stop"
      scrollIntoView={{
        behavior: reducedMotion ? "auto" : "smooth",
        block: "center",
        inline: "nearest",
      }}
    >
      <TourFocusGuard />
      {children}
    </TourProvider>
  )
}
