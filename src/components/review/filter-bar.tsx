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
  className?: string
}

export function FilterBar({
  basePath,
  params,
  fields,
  search,
  className,
}: FilterBarProps) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const searchTimer = useRef<number | null>(null)

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
        "flex flex-wrap items-center gap-2 rounded-xl border bg-card p-2",
        className
      )}
    >
      {fields.map((field) => (
        <Select
          key={field.key}
          items={field.options.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
          value={field.value}
          onValueChange={(value) => {
            if (typeof value === "string") {
              apply({ [field.key]: value })
            }
          }}
        >
          <SelectTrigger
            size="sm"
            aria-label={field.label}
            className="min-w-36 hover:bg-accent"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start" alignItemWithTrigger={false}>
            {field.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}

      {search ? (
        <Input
          ref={inputRef}
          data-review-search
          className="h-7 min-w-48 flex-1 text-sm"
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
      ) : null}

      {active ? (
        <Button variant="ghost" size="sm" onClick={reset}>
          <X data-icon="inline-start" />
          Reset
        </Button>
      ) : null}
    </div>
  )
}
