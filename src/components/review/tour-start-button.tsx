"use client"

import { Compass } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { prepareTourSteps } from "@/components/review/tours"
import { Button, buttonVariants } from "@/components/ui/button"
import { useTour } from "@/components/ui/tour"
import {
  TOURS,
  tourHref,
  tourIdForPath,
  withTourParam,
  type TourId,
} from "@/lib/review/tour-routes"
import { cn } from "@/lib/utils"

export interface TourStartButtonProps {
  tour: TourId
  /** Destination for tours that need a concrete paper, item or repository. */
  href?: string | null
  className?: string
}

/**
 * Starts a tour in place when the current page owns it, otherwise renders a
 * real link carrying `?tour=`. Tours without a page or destination are
 * disabled rather than silently doing nothing.
 */
export function TourStartButton({
  tour,
  href,
  className,
}: TourStartButtonProps) {
  const pathname = usePathname()
  const { start } = useTour()
  const label = `Start the ${TOURS[tour].label.toLowerCase()} tour`
  const icon = <Compass data-icon="inline-start" />
  // Tour triggers sit in muted breadcrumb and toolbar rows on some pages, so
  // pin the label to the foreground color instead of inheriting the row.
  const triggerClassName = cn("text-foreground", className)

  if (tourIdForPath(pathname) === tour) {
    return (
      <Button
        variant="outline"
        size="sm"
        className={triggerClassName}
        onClick={() => start(prepareTourSteps(tour))}
      >
        {icon}
        {label}
      </Button>
    )
  }

  const destination = href ?? tourHref(tour)
  if (!destination) {
    return (
      <Button variant="outline" size="sm" className={triggerClassName} disabled>
        {icon}
        {label}
      </Button>
    )
  }

  return (
    <Link
      href={withTourParam(destination, tour)}
      className={cn(
        buttonVariants({ variant: "outline", size: "sm" }),
        triggerClassName
      )}
    >
      {icon}
      {label}
    </Link>
  )
}
