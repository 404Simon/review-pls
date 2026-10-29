import { redirect } from "next/navigation"

import { getSession } from "@/lib/session"

export default async function Page() {
  const session = await getSession()

  redirect(session ? "/dashboard" : "/sign-in")
}
