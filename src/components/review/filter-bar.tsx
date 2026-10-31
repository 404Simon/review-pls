"use client"

import { X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useRef } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { withQuery } from "@/lib/review/filters"
import { cn } from "@/lib/utils"

export interface FilterFieldOption {
  value: string
  label: string
}

export interface FilterField {
  key: string
  label: string
  value: string
  options: readonly FilterFieldOption[]
}

export interface FilterBarProps {
  basePath: string
  params: Record<string, string>
  fields: readonly FilterField[]
  search?: {
    value: string
    label: string
    placeholder: string
  }
  focusSearch?: boolean
  className?: string
}

export function FilterBar({
  basePath,
  params,
  fields,
  search,
  focusSearch = false,
  className,
}: FilterBarProps) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const searchTimer = useRef<number | null>(null)

  useEffect(() => {
    if (focusSearch) {
      inputRef.current?.focus()
    }
  }, [focusSearch])

  // Leaving the page inside the debounce window must not navigate the next page
  // back to the page that was just left.
  useEffect(() => {
    return () => {
      if (searchTimer.current !== null) {
        window.clearTimeout(searchTimer.current)
        searchTimer.current = null
      }
    }
  }, [])

  function clearSearchTimer() {
    if (searchTimer.current !== null) {
      window.clearTimeout(searchTimer.current)
      searchTimer.current = null
    }
  }

  function apply(patch: Record<string, string>) {
    clearSearchTimer()
    const next: Record<string, string> = { ...params, ...patch }
    router.replace(withQuery(basePath, next))
  }

  function reset() {
    clearSearchTimer()
    if (inputRef.current) {
      inputRef.current.value = ""
    }
    const next = { ...params }
    for (const key of ["severity", "kind", "status", "mine", "paper", "q"]) {
      delete next[key]
    }
    delete next.focus
    router.replace(withQuery(basePath, next))
  }

  // `batch` selects the data set, it is not a filter. Keeping it out of this
  // check means the dashboard does not look filtered just because a batch was
  // chosen, while Reset still preserves `batch` and `tab` in the URL.
  const active =
    fields.some(
      (field) =>
        field.key !== "batch" && field.value !== "all" && field.value !== ""
    ) || (search?.value ?? "") !== ""

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-card p-3 sm:flex-row sm:flex-wrap sm:items-end",
        className
      )}
    >
      {fields.map((field) => (
        <div key={field.key} className="flex min-w-36 flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            {field.label}
          </span>
          <Select
            value={field.value}
            onValueChange={(value) => {
              if (typeof value === "string") {
                apply({ [field.key]: value })
              }
            }}
          >
            <SelectTrigger size="sm" aria-label={field.label}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {field.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}

      {search ? (
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            {search.label}
          </span>
          <Input
            ref={inputRef}
            data-review-search
            defaultValue={search.value}
            onInput={(event) => {
              const value = event.currentTarget.value
              if (searchTimer.current !== null) {
                window.clearTimeout(searchTimer.current)
              }
              searchTimer.current = window.setTimeout(() => {
                apply({ q: value.trim() })
              }, 300)
            }}
            placeholder={search.placeholder}
            aria-label={search.label}
          />
        </div>
      ) : null}

      {active ? (
        <Button variant="ghost" size="sm" onClick={reset}>
          <X data-icon="inline-start" />
          Reset filters
        </Button>
      ) : null}
    </div>
  )
}
