import { redirect } from "next/navigation"
import type { Metadata } from "next"

import {
  PasswordForm,
  ProfileForm,
  type ProfileFormUser,
} from "@/components/review/profile-forms"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { getSession } from "@/lib/session"
import { pageMetadata } from "@/lib/site-metadata"

export const metadata: Metadata = pageMetadata({
  title: "Your profile",
  description:
    "Update your name, affiliation, and password for the review workspace.",
  path: "/profile",
})

export default async function ProfilePage() {
  const session = await getSession()

  if (!session) {
    redirect("/sign-in")
  }

  const { user } = session
  const profile: ProfileFormUser = {
    name: user.name,
    email: user.email,
    association: user.association ?? "none",
    title: user.title ?? "none",
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-medium text-balance">
          Your profile
        </h1>
        <p className="text-sm text-muted-foreground">
          These details appear next to your review decisions and in exports.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Account details</CardTitle>
          <CardDescription>
            Update how your name and affiliation are shown to other reviewers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm user={profile} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>
            Choose a new password for signing in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PasswordForm />
        </CardContent>
      </Card>
    </div>
  )
}
