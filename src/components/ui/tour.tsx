"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { autoUpdate } from "@floating-ui/react-dom"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

type TourSide = "top" | "right" | "bottom" | "left"
type TourAlign = "start" | "center" | "end"

interface TourStepContext {
  index: number
  total: number
  isFirst: boolean
  isLast: boolean
  next: () => void
  prev: () => void
  stop: () => void
  goTo: (index: number) => void
}

interface TourStep {
  /**
   * The element to highlight: a CSS selector, a ref, or a function returning
   * the element. Omit it to show a centered step with a fully dimmed page.
   */
  target?: string | React.RefObject<Element | null> | (() => Element | null)
  title?: React.ReactNode
  content?: React.ReactNode
  side?: TourSide
  align?: TourAlign
  /** Space between the target and the spotlight edge. */
  padding?: number
  /** Corner radius of the spotlight. */
  radius?: number
  /** Allow clicking the highlighted element through the overlay. */
  interactive?: boolean
  /** Replace the default popover body for this step. */
  render?: (ctx: TourStepContext) => React.ReactNode
  onEnter?: (ctx: { index: number }) => void
}

type TourEndReason = "finished" | "stopped"

interface TourContextValue {
  active: boolean
  index: number
  total: number
  step: TourStep | null
  start: (steps?: TourStep[], startIndex?: number) => void
  stop: () => void
  next: () => void
  prev: () => void
  goTo: (index: number) => void
}

const TourContext = React.createContext<TourContextValue | null>(null)

function useTour() {
  const context = React.useContext(TourContext)
  if (!context) {
    throw new Error("useTour must be used within a <TourProvider />.")
  }
  return context
}

function resolveTarget(step: TourStep): Element | null {
  if (!step.target) return null
  if (typeof step.target === "string") {
    return document.querySelector(step.target)
  }
  if (typeof step.target === "function") {
    return step.target()
  }
  return step.target.current
}

function padRect(rect: DOMRect, padding: number) {
  return new DOMRect(
    rect.x - padding,
    rect.y - padding,
    rect.width + padding * 2,
    rect.height + padding * 2
  )
}

interface TourProviderProps {
  children: React.ReactNode
  /** Default steps used when `start()` is called without arguments. */
  steps?: TourStep[]
  /** Default spotlight padding. @default 8 */
  padding?: number
  /** Default spotlight corner radius. @default 10 */
  radius?: number
  /** Highlighted elements stay clickable by default. @default true */
  interactive?: boolean
  /** How the target is scrolled into view, or `false` to disable. */
  scrollIntoView?: ScrollIntoViewOptions | false
  /** Arrow-key and Escape navigation. @default true */
  keyboard?: boolean
  /** What clicking the dimmed overlay does. @default "stop" */
  overlayClick?: "stop" | "next" | "none"
  labels?: { back?: string; next?: string; done?: string }
  onStepChange?: (index: number, step: TourStep) => void
  onEnd?: (reason: TourEndReason) => void
}

function TourProvider({
  children,
  steps: defaultSteps,
  padding = 8,
  radius = 10,
  interactive = true,
  scrollIntoView = { behavior: "smooth", block: "center", inline: "nearest" },
  keyboard = true,
  overlayClick = "stop",
  labels,
  onStepChange,
  onEnd,
}: TourProviderProps) {
  const [steps, setSteps] = React.useState<TourStep[]>([])
  const [index, setIndex] = React.useState(0)
  // `open` and `index` are tracked separately: ending a tour only flips
  // `open`, so the last step stays rendered during the exit animation.
  const [open, setOpen] = React.useState(false)

  const step = steps[index] ?? null
  const active = open && step !== null

  // Latest callbacks, so effects and stable handlers never go stale.
  const callbacksRef = React.useRef<{
    onStepChange?: TourProviderProps["onStepChange"]
    onEnd?: TourProviderProps["onEnd"]
    defaultSteps?: TourStep[]
  }>({})
  React.useEffect(() => {
    callbacksRef.current = { onStepChange, onEnd, defaultSteps }
  })

  const start = React.useCallback(
    (nextSteps?: TourStep[], startIndex = 0) => {
      const resolved = nextSteps ?? callbacksRef.current.defaultSteps ?? []
      if (resolved.length === 0) return
      setSteps(resolved)
      setIndex(startIndex)
      setOpen(true)
    },
    []
  )

  const endWith = React.useCallback(
    (reason: TourEndReason) => {
      if (!active) return
      setOpen(false)
      callbacksRef.current.onEnd?.(reason)
    },
    [active]
  )

  const stop = React.useCallback(() => endWith("stopped"), [endWith])

  const next = React.useCallback(() => {
    if (!active) return
    if (index >= steps.length - 1) {
      endWith("finished")
    } else {
      setIndex(index + 1)
    }
  }, [active, index, steps.length, endWith])

  const prev = React.useCallback(() => {
    if (!active) return
    setIndex(Math.max(0, index - 1))
  }, [active, index])

  const goTo = React.useCallback(
    (nextIndex: number) => {
      if (!active) return
      setIndex(Math.min(Math.max(0, nextIndex), steps.length - 1))
    },
    [active, steps.length]
  )

  // Resolving during render keeps the target available for the popover's
  // exit animation after the tour closes. The tour can only ever be active
  // on the client, so `document` access is safe here.
  const targetEl = React.useMemo(
    () => (step ? resolveTarget(step) : null),
    [step]
  )

  React.useEffect(() => {
    if (!active || !step) return
    step.onEnter?.({ index })
    callbacksRef.current.onStepChange?.(index, step)
    if (targetEl && scrollIntoView) {
      targetEl.scrollIntoView(scrollIntoView)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, step, index, targetEl])

  React.useEffect(() => {
    if (!active || !keyboard) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      // Leave arrow keys alone while the user is typing in a field.
      const target = event.target
      if (
        event.key !== "Escape" &&
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        stop()
      } else if (event.key === "ArrowRight") {
        event.preventDefault()
        next()
      } else if (event.key === "ArrowLeft") {
        event.preventDefault()
        prev()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [active, keyboard, next, prev, stop])

  const contextValue = React.useMemo<TourContextValue>(
    () => ({
      active,
      index,
      total: steps.length,
      step: active ? step : null,
      start,
      stop,
      next,
      prev,
      goTo,
    }),
    [active, index, steps.length, step, start, stop, next, prev, goTo]
  )

  return (
    <TourContext.Provider value={contextValue}>
      {children}
      {active && step && (
        <TourOverlay
          step={step}
          targetEl={targetEl}
          padding={step.padding ?? padding}
          radius={step.radius ?? radius}
          interactive={step.interactive ?? interactive}
          overlayClick={overlayClick}
          onOverlayStop={stop}
          onOverlayNext={next}
        />
      )}
      <TourPopover
        open={active}
        step={step}
        targetEl={targetEl}
        padding={step?.padding ?? padding}
        ctx={{
          index,
          total: steps.length,
          isFirst: index <= 0,
          isLast: index === steps.length - 1,
          next,
          prev,
          stop,
          goTo,
        }}
        labels={labels}
      />
    </TourContext.Provider>
  )
}

/**
 * Dims the page and cuts a spotlight around the target. The spotlight is a
 * fixed element that draws the dim as a huge box-shadow; a separate
 * transparent blocker intercepts clicks outside the target. Both track the
 * target directly through Floating UI's `autoUpdate`.
 */
function TourOverlay({
  step,
  targetEl,
  padding,
  radius,
  interactive,
  overlayClick,
  onOverlayStop,
  onOverlayNext,
}: {
  step: TourStep
  targetEl: Element | null
  padding: number
  radius: number
  interactive: boolean
  overlayClick: "stop" | "next" | "none"
  onOverlayStop: () => void
  onOverlayNext: () => void
}) {
  const spotlightRef = React.useRef<HTMLDivElement>(null)
  const blockerRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const spotlight = spotlightRef.current
    const blocker = blockerRef.current
    if (!spotlight || !blocker) return

    const update = () => {
      if (targetEl) {
        const rect = padRect(targetEl.getBoundingClientRect(), padding)
        spotlight.style.top = `${rect.y}px`
        spotlight.style.left = `${rect.x}px`
        spotlight.style.width = `${rect.width}px`
        spotlight.style.height = `${rect.height}px`
        spotlight.style.borderRadius = `${radius}px`
        spotlight.style.backgroundColor = "transparent"
        if (interactive) {
          // A single path whose inner rect winds counter-clockwise, punching
          // an interactive hole into the blocker via the nonzero fill rule.
          const { innerWidth: vw, innerHeight: vh } = window
          blocker.style.clipPath = `path("M0 0H${vw}V${vh}H0Z M${rect.x} ${rect.y}v${rect.height}h${rect.width}v${-rect.height}Z")`
        } else {
          blocker.style.clipPath = "none"
        }
      } else {
        // Centered step: the spotlight covers the viewport and paints the
        // dim itself (a zero-size box would not render its shadow).
        spotlight.style.top = "0px"
        spotlight.style.left = "0px"
        spotlight.style.width = `${window.innerWidth}px`
        spotlight.style.height = `${window.innerHeight}px`
        spotlight.style.borderRadius = "0px"
        // Longhand on purpose: assigning a var() to the `background`
        // shorthand through the CSSOM does not paint reliably in Chrome.
        spotlight.style.backgroundColor =
          "var(--tour-overlay, oklch(0.145 0 0 / 0.72))"
        blocker.style.clipPath = "none"
      }
    }

    // Animate towards a new step's target, then track it rigidly so the
    // spotlight never trails behind the page while the user scrolls.
    spotlight.style.transitionDuration = ""
    const settle = window.setTimeout(() => {
      spotlight.style.transitionDuration = "0s"
    }, 350)

    let cleanup: (() => void) | undefined
    if (!targetEl) {
      update()
      window.addEventListener("resize", update)
      cleanup = () => window.removeEventListener("resize", update)
    } else {
      cleanup = autoUpdate(targetEl, spotlight, update)
    }
    return () => {
      window.clearTimeout(settle)
      cleanup?.()
    }
  }, [targetEl, padding, radius, interactive, step])

  const handleOverlayClick = () => {
    if (overlayClick === "stop") onOverlayStop()
    else if (overlayClick === "next") onOverlayNext()
  }

  // The overlay only renders while a tour is active, which can only happen
  // after client-side interaction, so document is always available.
  return createPortal(
    <>
      <div
        ref={blockerRef}
        data-slot="tour-blocker"
        onClick={handleOverlayClick}
        className="fixed inset-0 z-[100]"
      />
      <div
        ref={spotlightRef}
        data-slot="tour-spotlight"
        className="pointer-events-none fixed z-[100] shadow-[0_0_0_200vmax_var(--tour-overlay,oklch(0.145_0_0/0.72))] ring-1 ring-white/10 transition-all duration-300 ease-in-out motion-reduce:transition-none"
      />
    </>,
    document.body
  )
}

function TourPopover({
  open,
  step,
  targetEl,
  padding,
  ctx,
  labels,
}: {
  open: boolean
  step: TourStep | null
  targetEl: Element | null
  padding: number
  ctx: TourStepContext
  labels?: TourProviderProps["labels"]
}) {
  const positionerRef = React.useRef<HTMLDivElement>(null)
  const hadStepRef = React.useRef(false)

  // Slide towards a new step's anchor, then track it rigidly, and never
  // animate the very first positioning after opening.
  React.useEffect(() => {
    const node = positionerRef.current
    if (!open || !node) {
      hadStepRef.current = false
      return
    }
    if (!hadStepRef.current) {
      hadStepRef.current = true
      node.style.transitionDuration = "0s"
      return
    }
    node.style.transitionDuration = ""
    const settle = window.setTimeout(() => {
      node.style.transitionDuration = "0s"
    }, 350)
    return () => window.clearTimeout(settle)
  }, [open, step, targetEl])

  // The popover anchors to a Floating UI virtual element describing the
  // spotlight rect; `contextElement` lets autoUpdate follow scroll/resize.
  const anchor = React.useMemo(
    () => ({
      getBoundingClientRect: () =>
        targetEl
          ? padRect(targetEl.getBoundingClientRect(), padding)
          : new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 0, 0),
      contextElement: targetEl ?? undefined,
    }),
    [targetEl, padding]
  )

  return (
    <PopoverPrimitive.Root
      open={open}
      modal={false}
      onOpenChange={(nextOpen, details) => {
        // The tour owns the open state; only Escape may close it.
        if (!nextOpen && details.reason === "escape-key") ctx.stop()
      }}
    >
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          ref={positionerRef}
          anchor={anchor}
          side={step?.side ?? "bottom"}
          align={step?.align ?? "center"}
          sideOffset={12}
          collisionPadding={16}
          className="isolate z-[101] transition-transform duration-300 ease-in-out motion-reduce:transition-none"
        >
          <PopoverPrimitive.Popup
            data-slot="tour-popover"
            className="flex w-80 origin-(--transform-origin) flex-col gap-3 rounded-2xl bg-popover p-4 text-sm text-popover-foreground shadow-2xl ring-1 ring-foreground/5 outline-hidden duration-150 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95"
          >
            {targetEl && (
              <PopoverPrimitive.Arrow
                data-slot="tour-popover-arrow"
                className="z-[-1] size-2.5 rotate-45 rounded-[2px] bg-popover ring-1 ring-foreground/5 data-[side=bottom]:-top-[5px] data-[side=left]:-right-[5px] data-[side=right]:-left-[5px] data-[side=top]:-bottom-[5px]"
              />
            )}
            {step?.render ? (
              step.render(ctx)
            ) : (
              <>
                <div className="flex items-start justify-between gap-4">
                  {step?.title != null && (
                    <PopoverPrimitive.Title
                      data-slot="tour-popover-title"
                      className="text-base font-medium"
                    >
                      {step.title}
                    </PopoverPrimitive.Title>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="-mt-1 -mr-1 ml-auto text-muted-foreground"
                    aria-label="Close tour"
                    onClick={ctx.stop}
                  >
                    <XIcon />
                  </Button>
                </div>
                {step?.content != null && (
                  <PopoverPrimitive.Description
                    data-slot="tour-popover-content"
                    render={<div />}
                    className="text-muted-foreground"
                  >
                    {step.content}
                  </PopoverPrimitive.Description>
                )}
                <div className="mt-1 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="sr-only">
                      Step {ctx.index + 1} of {ctx.total}
                    </span>
                    {Array.from({ length: ctx.total }, (_, i) => (
                      <button
                        key={i}
                        type="button"
                        tabIndex={-1}
                        aria-hidden
                        onClick={() => ctx.goTo(i)}
                        className={cn(
                          "size-1.5 rounded-full transition-colors",
                          i === ctx.index
                            ? "bg-primary"
                            : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
                        )}
                      />
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    {!ctx.isFirst && (
                      <Button variant="ghost" size="xs" onClick={ctx.prev}>
                        {labels?.back ?? "Back"}
                      </Button>
                    )}
                    <Button size="xs" onClick={ctx.next}>
                      {ctx.isLast
                        ? (labels?.done ?? "Done")
                        : (labels?.next ?? "Next")}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

export { TourProvider, useTour }
export type {
  TourStep,
  TourStepContext,
  TourEndReason,
  TourProviderProps,
  TourContextValue,
  TourSide,
  TourAlign,
}
