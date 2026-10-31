import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { ItemStatus } from "@/lib/review/types"

const STYLES: Readonly<Record<ItemStatus, string>> = {
  open: "border-border bg-background text-muted-foreground",
  claimed:
    "border-transparent bg-info text-info-foreground ring-1 ring-info-border",
  unsure:
    "border-transparent bg-warning text-warning-foreground ring-1 ring-warning-border",
  closed:
    "border-transparent bg-success/10 text-success ring-1 ring-success/25",
}

const LABELS: Readonly<Record<ItemStatus, string>> = {
  open: "Open",
  claimed: "Claimed",
  unsure: "Unsure",
  closed: "Closed",
}

export function StatusBadge({
  status,
  className,
}: {
  status: ItemStatus
  className?: string
}) {
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5", STYLES[status], className)}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {LABELS[status]}
    </Badge>
  )
}
