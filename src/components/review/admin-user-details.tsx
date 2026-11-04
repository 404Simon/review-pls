"use client"

import { Activity, Eye, ListChecks, Mail } from "lucide-react"
import Link from "next/link"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatTimestamp } from "@/lib/review/format"
import type { UserRole } from "@/lib/review/roles"
import type { UserActivity } from "@/lib/review/user-activity"

export interface AdminUserDetailsUser {
  id: string
  name: string
  email: string
  emailVerified: boolean
  role: UserRole
  image: string | null
  association: string | null
  title: string | null
  frozenAt: number | null
  createdAt: number
  updatedAt: number
}

export function AdminUserDetails({
  user,
  candidate,
  isSelf,
  activity,
}: {
  user: AdminUserDetailsUser
  /** The email is listed in `ADMIN_EMAILS` and is promoted on server start. */
  candidate: boolean
  isSelf: boolean
  activity: UserActivity
}) {
  const totals = activity.batches.reduce(
    (sum, batch) => ({
      closed: sum.closed + batch.closed,
      unsure: sum.unsure + batch.unsure,
      drafts: sum.drafts + batch.drafts,
      total: sum.total + batch.total,
    }),
    { closed: 0, unsure: 0, drafts: 0, total: 0 }
  )

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>
        <Eye data-icon="inline-start" />
        Details
        <span className="sr-only"> for {user.email}</span>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3 pr-8">
            <Avatar size="lg">
              {user.image ? <AvatarImage src={user.image} alt="" /> : null}
              <AvatarFallback>
                {initialsOf(user.name, user.email)}
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col gap-1">
              <DialogTitle className="flex flex-wrap items-center gap-2">
                {user.name}
                <Badge variant={user.role === "admin" ? "default" : "outline"}>
                  {user.role}
                </Badge>
                {user.frozenAt ? (
                  <Badge variant="destructive">Frozen</Badge>
                ) : null}
                {isSelf ? <Badge variant="secondary">You</Badge> : null}
              </DialogTitle>
              <DialogDescription className="flex items-center gap-1.5">
                <Mail data-icon="inline-start" />
                <span className="break-all">{user.email}</span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <section className="flex flex-col gap-2">
          <h3 className="font-heading text-sm font-medium">Profile</h3>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Detail label="Name">{user.name}</Detail>
            <Detail label="Email status">
              <Badge variant={user.emailVerified ? "secondary" : "outline"}>
                {user.emailVerified ? "Verified" : "Not verified"}
              </Badge>
            </Detail>
            <Detail label="Role">
              <span className="flex flex-wrap items-center gap-1">
                <span className="capitalize">{user.role}</span>
                {candidate ? (
                  <Badge variant="secondary">ADMIN_EMAILS</Badge>
                ) : null}
              </span>
            </Detail>
            <Detail label="Title">{user.title || "—"}</Detail>
            <Detail label="Association">{user.association || "—"}</Detail>
            <Detail label="Account status">
              {user.frozenAt ? (
                <span className="flex flex-wrap items-center gap-1">
                  <Badge variant="destructive">Frozen</Badge>
                  <span className="text-xs text-muted-foreground">
                    since {formatTimestamp(user.frozenAt)}
                  </span>
                </span>
              ) : (
                <Badge variant="outline">Active</Badge>
              )}
            </Detail>
            <Detail label="Profile updated">
              {formatTimestamp(user.updatedAt)}
            </Detail>
            <Detail label="Registered">
              {formatTimestamp(user.createdAt)}
            </Detail>
            <Detail label="User ID">
              <span className="font-mono text-xs break-all select-all">
                {user.id}
              </span>
            </Detail>
          </dl>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="flex items-center gap-2 font-heading text-sm font-medium">
            <Activity data-icon="inline-start" />
            Review activity
          </h3>
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <Metric label="Closed" value={totals.closed} />
            <Metric label="Unsure" value={totals.unsure} />
            <Metric label="Drafts" value={totals.drafts} />
            <Metric label="Decision rows" value={totals.total} />
            <Metric label="Active claims" value={activity.activeClaims} />
            <Metric label="Unsure events" value={activity.events.unsure} />
            <Metric label="Reopened events" value={activity.events.reopened} />
            <Metric label="Closed events" value={activity.events.closed} />
          </div>
          <p className="text-xs text-muted-foreground">
            Last activity:{" "}
            {activity.lastActivityAt === null
              ? "none yet"
              : formatTimestamp(activity.lastActivityAt)}
          </p>

          {activity.batches.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No decision rows in any mounted batch.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch</TableHead>
                  <TableHead>Closed</TableHead>
                  <TableHead>Unsure</TableHead>
                  <TableHead>Drafts</TableHead>
                  <TableHead>Rows</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activity.batches.map((batch) => (
                  <TableRow key={batch.batchId}>
                    <TableCell className="font-mono text-xs">
                      {batch.batchId}
                    </TableCell>
                    <TableCell>{batch.closed}</TableCell>
                    <TableCell>{batch.unsure}</TableCell>
                    <TableCell>{batch.drafts}</TableCell>
                    <TableCell>{batch.total}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>

        <div className="flex justify-end">
          <Link
            href={`/admin/users/${encodeURIComponent(user.id)}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ListChecks data-icon="inline-start" />
            All decisions
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function initialsOf(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const initials = parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("")
  return initials || email.charAt(0).toUpperCase()
}

function Detail({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border px-2 py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-heading text-lg font-medium">{value}</span>
    </div>
  )
}
