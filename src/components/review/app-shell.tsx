import { SearchCheck, Snowflake } from "lucide-react"
import Link from "next/link"
import { Suspense } from "react"

import { BatchNav } from "@/components/review/batch-nav"
import { GithubIcon } from "@/components/review/github-icon"
import { BatchSelect } from "@/components/review/batch-select"
import { KeyboardLayer } from "@/components/review/keyboard-layer"
import { ThemeToggle } from "@/components/review/theme-toggle"
import { UserMenu } from "@/components/review/user-menu"
import { WorkspaceNav } from "@/components/review/workspace-nav"
import { db } from "@/db"
import { isUserFrozen } from "@/lib/review/account-status"
import { batchNavItems } from "@/lib/review/batch-nav"
import { listBatches, ReviewDataError } from "@/lib/review/load"
import { TOUR_ANCHORS } from "@/lib/review/tour-routes"

export interface AppShellUser {
  name: string
  email: string
}

export interface AppShellProps {
  user: AppShellUser
  userId: string
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
  userId,
  activeBatchId,
  isAdmin,
  children,
}: AppShellProps) {
  const summary = await safeBatches()
  const frozen = isUserFrozen(db, userId)
  // Only pass the label to the client. Loader errors contain absolute mount
  // paths and must stay in the server-rendered admin details block.
  const batches = summary.map((batch) => ({
    batchId: batch.batchId,
    label: batch.error ? `${batch.label} (data error)` : batch.label,
  }))
  const healthy = summary.filter((batch) => batch.error === undefined)
  const defaultBatchId = (healthy[0] ?? summary[0])?.batchId ?? null
  // Render the nav in the first paint. The client BatchNav then corrects the
  // dashboard links from `?batch=` once search params are available.
  const fallbackNav = batchNavItems(activeBatchId ?? defaultBatchId, {
    isAdmin,
  })

  return (
    <div data-app-root className="flex min-h-svh flex-col bg-muted/30">
      <a
        href="#main-content"
        className="sr-only rounded-md bg-background px-3 py-2 text-sm font-medium ring-1 ring-border focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
      >
        Skip to content
      </a>
      <KeyboardLayer />
      <header
        data-tour={TOUR_ANCHORS.shellNav}
        className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/70"
      >
        <div className="mx-auto flex w-full max-w-[100rem] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-6">
          <Link
            href="/dashboard"
            className="group flex min-w-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm transition-transform group-hover:-rotate-3">
              <SearchCheck className="size-4" />
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-sm font-semibold tracking-tight">
                review-pls
              </span>
              <span className="truncate text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">
                Review workspace
              </span>
            </span>
          </Link>

          <span className="hidden h-7 w-px bg-border md:block" aria-hidden />

          <div className="order-3 w-full min-w-0 md:order-none md:w-auto">
            <Suspense fallback={<WorkspaceNav items={fallbackNav} />}>
              <BatchNav
                activeBatchId={activeBatchId}
                defaultBatchId={defaultBatchId}
                isAdmin={isAdmin}
              />
            </Suspense>
          </div>

          <div className="ml-auto flex min-w-0 items-center gap-1.5">
            <Suspense fallback={null}>
              <BatchSelect
                batches={batches}
                activeBatchId={activeBatchId}
                defaultBatchId={defaultBatchId}
              />
            </Suspense>
            <ThemeToggle />
            <UserMenu name={user.name} email={user.email} isAdmin={isAdmin} />
          </div>
        </div>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-[100rem] flex-1 flex-col gap-6 p-4 outline-none sm:p-6"
      >
        {frozen ? (
          <div
            role="status"
            className="flex items-start gap-2 rounded-xl border border-warning-border bg-warning px-4 py-3 text-sm text-warning-foreground"
          >
            <Snowflake data-icon="inline-start" className="mt-0.5 shrink-0" />
            <div className="flex flex-col gap-0.5">
              <p className="font-medium">Your account is frozen</p>
              <p>
                You can browse reviews and decisions, but you cannot reserve
                items or save changes. Ask an admin to unfreeze your account.
              </p>
            </div>
          </div>
        ) : null}
        {children}
      </main>

      <footer className="border-t bg-background/60">
        <div className="mx-auto flex w-full max-w-[100rem] items-center justify-center px-4 py-4 sm:px-6">
          <Link
            href="https://github.com/404Simon/review-pls"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <GithubIcon />
            Thanks for your help &lt;3
          </Link>
        </div>
      </footer>
    </div>
  )
}
