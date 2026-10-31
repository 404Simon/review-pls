import { ChevronRight, type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * Native `<details>` disclosure for secondary page sections. Closed by default
 * so the primary task stays at the top of a long review page.
 */
export function Disclosure({
  title,
  description,
  icon: Icon,
  trailing,
  className,
  children,
}: {
  title: string
  description?: ReactNode
  icon?: LucideIcon
  trailing?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <details className={cn("group rounded-xl border bg-card", className)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
        />
        {Icon ? <Icon aria-hidden className="size-4 shrink-0" /> : null}
        <span className="min-w-0 flex-1">
          {title}
          {description ? (
            <span className="block text-xs font-normal text-muted-foreground">
              {description}
            </span>
          ) : null}
        </span>
        {trailing}
      </summary>
      <div className="border-t px-4 py-4">{children}</div>
    </details>
  )
}
