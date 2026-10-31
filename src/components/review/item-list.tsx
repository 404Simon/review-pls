"use client"

import { FilterX, Inbox } from "lucide-react"
import { useRouter } from "next/navigation"

import { EmptyState } from "@/components/review/empty-state"
import { FilterBar } from "@/components/review/filter-bar"
import { ItemCard } from "@/components/review/item-card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ItemReviewState } from "@/lib/review/decisions"
import {
  ITEM_TABS,
  itemPath,
  kindForTab,
  matchesReviewFilters,
  queryFromFilters,
  type ItemTab,
  type ReviewFilters,
  withQuery,
} from "@/lib/review/filters"
import type { ReviewItem } from "@/lib/review/types"

export interface ItemListProps {
  batchId: string
  basePath: string
  params: Record<string, string>
  items: readonly ReviewItem[]
  states: Record<string, ItemReviewState>
  reviewerNames: Record<string, string>
  currentUserId: string
  filters: ReviewFilters
  tab: ItemTab
  focusSearch: boolean
}

export function ItemList({
  batchId,
  basePath,
  params,
  items,
  states,
  reviewerNames,
  currentUserId,
  filters,
  tab,
  focusSearch,
}: ItemListProps) {
  const router = useRouter()
  const activeFilters =
    filters.severity !== "all" ||
    filters.kind !== "all" ||
    filters.status !== "all" ||
    filters.mine ||
    filters.search !== ""

  function itemsForTab(value: ItemTab): ReviewItem[] {
    const tabKind = kindForTab(value)
    const tabItems =
      tabKind === null ? items : items.filter((item) => item.kind === tabKind)
    return tabItems.filter((item) => {
      const state = states[item.id]
      return state
        ? matchesReviewFilters(item, state, filters, currentUserId)
        : false
    })
  }

  function renderPanel(value: ItemTab) {
    const tabItemsFull =
      kindForTab(value) === null
        ? items
        : items.filter((item) => item.kind === kindForTab(value))
    const visible = itemsForTab(value)
    const linkParams = {
      ...queryFromFilters(filters),
      tab: value,
      from: "paper",
    }

    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>
            Showing {visible.length} of {tabItemsFull.length} item
            {tabItemsFull.length === 1 ? "" : "s"} in this tab
          </span>
          {activeFilters ? (
            <span className="text-xs">
              Use “Reset filters” to clear the search.
            </span>
          ) : null}
        </div>

        {visible.length === 0 ? (
          <EmptyState
            icon={activeFilters ? FilterX : Inbox}
            title={
              activeFilters
                ? "No items match these filters"
                : "Nothing in this tab"
            }
            description={
              activeFilters
                ? "Use “Reset filters” above to see the full paper. The counts on the tabs always cover the whole paper."
                : "This paper has no items of this type. Try another tab or open the batch queue."
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            {visible.map((item) => {
              const state = states[item.id]
              if (!state) {
                return null
              }
              return (
                <ItemCard
                  key={item.id}
                  item={item}
                  state={state}
                  names={reviewerNames}
                  href={withQuery(itemPath(batchId, item.id), linkParams)}
                />
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (typeof value === "string") {
            router.replace(withQuery(basePath, { ...params, tab: value }))
          }
        }}
      >
        <TabsList
          variant="line"
          className="w-full justify-start overflow-x-auto"
        >
          {ITEM_TABS.map((entry) => {
            const count =
              entry.kind === null
                ? items.length
                : items.filter((item) => item.kind === entry.kind).length
            return (
              <TabsTrigger key={entry.value} value={entry.value}>
                {entry.label}
                <Badge variant="outline">{count}</Badge>
              </TabsTrigger>
            )
          })}
        </TabsList>

        {/* Keep the controls between the tab strip and the panel so reviewers
            can filter without scrolling past the list. */}
        <FilterBar
          basePath={basePath}
          params={params}
          focusSearch={focusSearch}
          fields={[
            {
              key: "severity",
              label: "Severity",
              value: filters.severity,
              options: [
                { value: "all", label: "All severities" },
                { value: "high", label: "High" },
                { value: "medium", label: "Medium" },
                { value: "low", label: "Low" },
              ],
            },
            {
              key: "status",
              label: "Status",
              value: filters.status,
              options: [
                { value: "all", label: "All statuses" },
                { value: "open", label: "Open" },
                { value: "claimed", label: "Claimed" },
                { value: "unsure", label: "Unsure" },
                { value: "closed", label: "Closed" },
              ],
            },
            {
              key: "mine",
              label: "Assignment",
              value: filters.mine ? "mine" : "all",
              options: [
                { value: "all", label: "Anyone" },
                { value: "mine", label: "Only mine" },
              ],
            },
          ]}
          search={{
            value: filters.search,
            label: "Search this paper",
            placeholder: "Title, summary or ref",
          }}
        />

        {ITEM_TABS.map((entry) => (
          <TabsContent key={entry.value} value={entry.value}>
            {renderPanel(entry.value)}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
