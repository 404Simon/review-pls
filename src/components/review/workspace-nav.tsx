"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"

export interface WorkspaceNavItem {
  href: string
  label: string
  activePrefixes: readonly string[]
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
    <nav
      aria-label="Workspace"
      className="flex w-full items-center gap-1 overflow-x-auto rounded-lg bg-muted/60 p-1 md:w-fit"
    >
      {items.map((item) => {
        const active = isActive(pathname, item.activePrefixes)
        const className = cn(
          "shrink-0 rounded-md px-2.5 py-1 text-sm whitespace-nowrap transition-colors",
          active
            ? "bg-background font-medium text-foreground shadow-sm ring-1 ring-border/60"
            : "text-muted-foreground",
          "hover:bg-background/60 hover:text-foreground"
        )
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
