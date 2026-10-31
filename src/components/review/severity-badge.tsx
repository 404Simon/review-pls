import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { Severity } from "@/lib/review/types"

const STYLES: Readonly<Record<Severity, string>> = {
  high: "bg-destructive/10 text-destructive ring-1 ring-destructive/20",
  medium: "bg-warning text-warning-foreground ring-1 ring-warning-border",
  low: "bg-info text-info-foreground ring-1 ring-info-border",
}

export function SeverityBadge({
  severity,
  className,
}: {
  severity: Severity
  className?: string
}) {
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 border-transparent", STYLES[severity], className)}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {severity}
    </Badge>
  )
}
