"use client"

import { Link2 } from "lucide-react"

import { SeverityBadge } from "@/components/review/severity-badge"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ItemKind, Severity } from "@/lib/review/types"

export interface LinkCandidate {
  kind: Extract<ItemKind, "agent_only" | "auditowl_only">
  ref: string
  title: string
  severity: Severity
  closest: boolean
}

export function LinkPicker({
  candidates,
  value,
  onChange,
  disabled,
}: {
  candidates: readonly LinkCandidate[]
  value: string
  onChange: (ref: string) => void
  disabled: boolean
}) {
  if (candidates.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No finding of the opposite side exists in this paper, so a proposed link
        cannot be recorded.
      </p>
    )
  }

  const selected = candidates.find((candidate) => candidate.ref === value)

  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-sm font-medium">
        <Link2 data-icon="inline-start" />
        Optional proposed link
      </span>
      <Select
        value={value === "" ? "none" : value}
        onValueChange={(next) => {
          if (typeof next === "string") {
            onChange(next === "none" ? "" : next)
          }
        }}
        disabled={disabled}
      >
        <SelectTrigger
          aria-label="Proposed link to the opposite side"
          className="w-full"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No proposed link</SelectItem>
          {candidates.map((candidate) => (
            <SelectItem key={candidate.ref} value={candidate.ref}>
              <span className="flex items-center gap-1.5">
                <span className="font-mono text-xs">{candidate.ref}</span>
                <span className="max-w-72 truncate">{candidate.title}</span>
                {candidate.closest ? (
                  <Badge variant="outline">closest</Badge>
                ) : null}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Records that this is the same defect as the selected item. The other
        item is not changed. The closest comparator suggestions come first.
      </p>
      {selected ? (
        <span className="flex items-center gap-2 text-xs">
          <SeverityBadge severity={selected.severity} />
          {selected.title}
        </span>
      ) : null}
    </div>
  )
}
