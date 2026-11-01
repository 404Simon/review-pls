"use client"

import { ChevronDown } from "lucide-react"
import { useState, type ReactNode } from "react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

/**
 * A nested disclosure inside an expanded finding. The summary always states
 * what is inside and how much of it there is, so a collapsed section still
 * tells the reviewer that evidence exists.
 */
export function EvidenceSection({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string
  summary: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="overflow-hidden rounded-lg border bg-card"
    >
      <CollapsibleTrigger className="flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2.5 text-left outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium">{title}</span>
          {open ? null : (
            <span className="text-xs text-muted-foreground">{summary}</span>
          )}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t px-3 py-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
