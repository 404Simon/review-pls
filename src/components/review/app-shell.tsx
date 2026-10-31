import Link from "next/link"
import { Suspense } from "react"

import { BatchNav } from "@/components/review/batch-nav"
import { BatchSelect } from "@/components/review/batch-select"
import { KeyboardLayer } from "@/components/review/keyboard-layer"
import { ThemeToggle } from "@/components/review/theme-toggle"
import { WorkspaceNav } from "@/components/review/workspace-nav"
import { SignOutButton } from "@/components/sign-out-button"
import { batchNavItems } from "@/lib/review/batch-nav"
import { listBatches, ReviewDataError } from "@/lib/review/load"

export interface AppShellUser {
  name: string
  email: string
}

export interface AppShellProps {
  user: AppShellUser
  activeBatchId: string | null
  isAdmin: boolean
  children: React.ReactNode
}

async function safeBatches() {
  try {
    return await listBatches()
  } catch (error) {
    if (error instanceof ReviewDataError) {
      return []
    }
    throw error
  }
}

export async function AppShell({
  user,
  activeBatchId,
  isAdmin,
  children,
}: AppShellProps) {
  const summary = await safeBatches()
  // Only pass the label to the client. Loader errors contain absolute mount
  // paths and must stay in the server-rendered admin details block.
  const batches = summary.map((batch) => ({
    batchId: batch.batchId,
    label: batch.error ? `${batch.label} (data error)` : batch.label,
  }))
  const healthy = summary.filter((batch) => batch.error === undefined)
  const batchIds = summary.map((batch) => batch.batchId)
  const defaultBatchId = (healthy[0] ?? summary[0])?.batchId ?? null
  // Render the nav in the first paint. The client BatchNav then corrects the
  // dashboard links from `?batch=` once search params are available.
  const fallbackNav = batchNavItems(activeBatchId ?? defaultBatchId, {
    isAdmin,
  })

  return (
    <div className="flex min-h-svh flex-col bg-muted/30">
      <a
        href="#main-content"
        className="sr-only rounded-md bg-background px-3 py-2 text-sm font-medium ring-1 ring-border focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
      >
        Skip to content
      </a>
      <KeyboardLayer />
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex w-full max-w-[100rem] flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <Link href="/dashboard" className="flex min-w-0 flex-col">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              review-pls
            </span>
            <span className="truncate text-sm font-medium">
              Review workspace
            </span>
          </Link>

          <span className="hidden h-6 w-px bg-border sm:block" aria-hidden />

          <Suspense fallback={<WorkspaceNav items={fallbackNav} />}>
            <BatchNav
              activeBatchId={activeBatchId}
              batchIds={batchIds}
              defaultBatchId={defaultBatchId}
              isAdmin={isAdmin}
            />
          </Suspense>

          <div className="ml-auto flex min-w-0 items-center gap-2">
            <Suspense fallback={null}>
              <BatchSelect batches={batches} activeBatchId={activeBatchId} />
            </Suspense>
            <ThemeToggle />
            <span className="hidden max-w-56 truncate text-sm text-muted-foreground lg:block">
              {user.email}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-[100rem] flex-1 flex-col gap-6 p-4 outline-none sm:p-6"
      >
        {children}
      </main>

      <footer className="border-t bg-background/60">
        <div className="mx-auto flex w-full max-w-[100rem] flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-muted-foreground sm:px-6">
          <span>
            {user.name} · human review of AuditOwl and review-agent overlap
          </span>
          <Link href="/guide" className="hover:text-foreground">
            Protocol guide
          </Link>
        </div>
      </footer>
    </div>
  )
}
