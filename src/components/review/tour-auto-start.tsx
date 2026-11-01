"use client"

import { usePathname, useSearchParams } from "next/navigation"
import { useEffect, useRef } from "react"

import { prepareTourSteps, TOUR_STEPS } from "@/components/review/tours"
import { useTour } from "@/components/ui/tour"
import {
  parseTourId,
  stripTourParam,
  TOUR_QUERY_PARAM,
  TOUR_READY_ANCHORS,
  tourIdForPath,
} from "@/lib/review/tour-routes"

const TARGET_TIMEOUT_MS = 3_000
const TARGET_POLL_MS = 100

/** Remove the transient tour key without adding a history entry. */
function removeTourParam() {
  const search = stripTourParam(window.location.search)
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${search}${window.location.hash}`
  )
}

/**
 * Starts the tour requested by `?tour=` on the page it belongs to, then removes
 * the parameter so a reload does not replay it. A parameter for another page is
 * dropped instead of lingering in the address bar.
 */
export function TourAutoStart() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const requested = parseTourId(searchParams.get(TOUR_QUERY_PARAM))
  const { start, stop } = useTour()
  const startedRef = useRef<string | null>(null)
  const stopRef = useRef(stop)
  const previousPathRef = useRef(pathname)

  useEffect(() => {
    stopRef.current = stop
  })

  // A tour belongs to the page it started on. Reset the guard as well, so the
  // same link can start the tour again after leaving and returning.
  useEffect(() => {
    if (previousPathRef.current === pathname) {
      return
    }
    previousPathRef.current = pathname
    startedRef.current = null
    stopRef.current()
  }, [pathname])

  useEffect(() => {
    if (!requested) {
      return
    }

    if (tourIdForPath(pathname) !== requested) {
      removeTourParam()
      return
    }

    const key = `${pathname}\u0000${requested}`
    if (startedRef.current === key) {
      return
    }
    startedRef.current = key

    let cancelled = false
    let started = false
    let timer: number | null = null

    const begin = (ready: boolean) => {
      // If the page never finishes streaming, keep the full tour rather than
      // silently starting with only the two steps that happened to be mounted.
      const steps = ready ? prepareTourSteps(requested) : TOUR_STEPS[requested]
      if (steps.length === 0) {
        return
      }
      start(steps)
      started = true
      removeTourParam()
    }

    // The shell header can render before the page body streams in. Waiting for
    // an anchor near the end of the page keeps `prepareTourSteps` from dropping
    // every step whose target has not arrived yet.
    const readyTarget = `[data-tour="${TOUR_READY_ANCHORS[requested]}"]`
    const deadline = Date.now() + TARGET_TIMEOUT_MS
    const poll = () => {
      if (cancelled || started) {
        return
      }
      const ready = document.querySelector(readyTarget) !== null
      if (ready || Date.now() >= deadline) {
        begin(ready)
        return
      }
      timer = window.setTimeout(poll, TARGET_POLL_MS)
    }
    poll()

    return () => {
      cancelled = true
      if (timer !== null) {
        window.clearTimeout(timer)
      }
      // StrictMode runs the effect twice. Only allow a retry when the first
      // pass had not actually opened the tour yet.
      if (!started) {
        startedRef.current = null
      }
    }
  }, [pathname, requested, start])

  return null
}
