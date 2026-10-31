import { redirect } from "next/navigation"

import { AppShell } from "@/components/review/app-shell"
import { db } from "@/db"
import { getUserRole } from "@/lib/review/roles"
import { getSession } from "@/lib/session"

export default async function BatchLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode
  params: Promise<{ batch: string }>
}>) {
  const session = await getSession()

  if (!session) {
    redirect("/sign-in")
  }

  const role = await getUserRole(session.user, { db })
  const { batch } = await params

  return (
    <AppShell
      user={{ name: session.user.name, email: session.user.email }}
      activeBatchId={batch}
      isAdmin={role === "admin"}
    >
      {children}
    </AppShell>
  )
}
