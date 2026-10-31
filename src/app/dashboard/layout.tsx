import { redirect } from "next/navigation"

import { AppShell } from "@/components/review/app-shell"
import { db } from "@/db"
import { getUserRole } from "@/lib/review/roles"
import { getSession } from "@/lib/session"

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const session = await getSession()

  if (!session) {
    redirect("/sign-in")
  }

  const role = await getUserRole(session.user, { db })

  return (
    <AppShell
      user={{ name: session.user.name }}
      activeBatchId={null}
      isAdmin={role === "admin"}
    >
      {children}
    </AppShell>
  )
}
