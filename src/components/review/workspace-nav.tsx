"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"

export interface WorkspaceNavItem {
  href: string
  label: string
  activePrefixes: readonly string[]
  disabled?: boolean
}

function isActive(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
}

export function WorkspaceNav({
  items,
}: {
  items: readonly WorkspaceNavItem[]
}) {
  const pathname = usePathname()

  return (
    <nav aria-label="Workspace" className="flex items-center gap-1">
      {items.map((item) => {
        const active = isActive(pathname, item.activePrefixes)
        const className = cn(
          "rounded-md px-2 py-1 text-sm transition-colors",
          active
            ? "bg-muted font-medium text-foreground"
            : "text-muted-foreground",
          item.disabled
            ? "cursor-not-allowed opacity-50"
            : "hover:bg-muted hover:text-foreground"
        )
        if (item.disabled) {
          return (
            <span
              key={item.label}
              aria-disabled="true"
              title="This batch is not mounted"
              className={className}
            >
              {item.label}
            </span>
          )
        }
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={className}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
