"use client"

import { KeyRound, Save } from "lucide-react"
import { useRouter } from "next/navigation"
import { useRef, useState, type FormEvent } from "react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { authClient } from "@/lib/auth-client"

export interface ProfileFormUser {
  name: string
  email: string
  association: string
  title: string
}

const NAME_MAX_LENGTH = 100
const DETAIL_MAX_LENGTH = 120

function displayValue(value: string): string {
  const trimmed = value.trim()
  return trimmed && trimmed !== "none" ? trimmed : ""
}

function storedValue(value: string): string {
  return value.trim() || "none"
}

export function ProfileForm({ user }: { user: ProfileFormUser }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setNameError(null)
    setFormError(null)

    const data = new FormData(event.currentTarget)
    const name = String(data.get("name") ?? "").trim()
    const association = storedValue(String(data.get("association") ?? ""))
    const title = storedValue(String(data.get("title") ?? ""))

    if (!name) {
      setNameError("Enter the name reviewers should see.")
      return
    }

    if (name.length > NAME_MAX_LENGTH) {
      setNameError(`Use at most ${NAME_MAX_LENGTH} characters.`)
      return
    }

    setPending(true)

    try {
      const { error } = await authClient.updateUser({
        name,
        association,
        title,
      })

      if (error) {
        setFormError(error.message ?? "Could not save your profile")
        return
      }

      toast.success("Profile updated")
      router.refresh()
    } catch (cause) {
      setFormError(
        cause instanceof Error ? cause.message : "Could not save your profile"
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {formError ? (
        <Alert variant="destructive">
          <AlertTitle>Profile not saved</AlertTitle>
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={nameError ? true : undefined}>
            <FieldLabel htmlFor="profile-name">Name</FieldLabel>
            <Input
              id="profile-name"
              name="name"
              autoComplete="name"
              defaultValue={user.name}
              maxLength={NAME_MAX_LENGTH}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={
                nameError ? "profile-name-error" : "profile-name-description"
              }
              required
            />
            <FieldDescription id="profile-name-description">
              Shown on decisions and in exports.
            </FieldDescription>
            <FieldError id="profile-name-error">{nameError}</FieldError>
          </Field>

          <Field>
            <FieldLabel htmlFor="profile-email">Email</FieldLabel>
            <Input
              id="profile-email"
              type="email"
              value={user.email}
              readOnly
              className="bg-muted/40"
            />
            <FieldDescription>
              Email changes are handled by the operator.
            </FieldDescription>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="profile-association">Association</FieldLabel>
            <Input
              id="profile-association"
              name="association"
              autoComplete="organization"
              placeholder="e.g. Chair of Software Engineering"
              defaultValue={displayValue(user.association)}
              maxLength={DETAIL_MAX_LENGTH}
            />
            <FieldDescription>
              Optional. Your chair, group, or affiliation.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="profile-title">Title</FieldLabel>
            <Input
              id="profile-title"
              name="title"
              list="profile-title-options"
              placeholder="e.g. M.Sc."
              defaultValue={displayValue(user.title)}
              maxLength={DETAIL_MAX_LENGTH}
            />
            <datalist id="profile-title-options">
              <option value="B.Sc." />
              <option value="M.Sc." />
              <option value="PhD" />
              <option value="Professor" />
            </datalist>
            <FieldDescription>Optional. Your academic title.</FieldDescription>
          </Field>
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Save data-icon="inline-start" />
            )}
            Save profile
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}

export function PasswordForm() {
  const formRef = useRef<HTMLFormElement>(null)
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)

    const data = new FormData(event.currentTarget)
    const currentPassword = String(data.get("currentPassword") ?? "")
    const newPassword = String(data.get("newPassword") ?? "")
    const confirmPassword = String(data.get("confirmPassword") ?? "")

    if (newPassword.length < 8) {
      setFormError("The new password must be at least 8 characters.")
      return
    }

    if (newPassword !== confirmPassword) {
      setFormError("The new passwords do not match.")
      return
    }

    setPending(true)

    try {
      const { error } = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      })

      if (error) {
        setFormError(error.message ?? "Could not change your password")
        return
      }

      formRef.current?.reset()
      toast.success("Password changed")
    } catch (cause) {
      setFormError(
        cause instanceof Error
          ? cause.message
          : "Could not change your password"
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-5">
      {formError ? (
        <Alert variant="destructive">
          <AlertTitle>Password not changed</AlertTitle>
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="current-password">Current password</FieldLabel>
          <Input
            id="current-password"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="new-password">New password</FieldLabel>
            <Input
              id="new-password"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
            <FieldDescription>Use at least 8 characters.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="confirm-password">
              Confirm new password
            </FieldLabel>
            <Input
              id="confirm-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </Field>
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Changing your password signs out other sessions.
          </p>
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <KeyRound data-icon="inline-start" />
            )}
            Change password
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
