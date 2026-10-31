import { Compass, FileQuestion } from "lucide-react"
import Link from "next/link"

import { EmptyState } from "@/components/review/empty-state"
import { buttonVariants } from "@/components/ui/button"

export default function BatchNotFound() {
  return (
    <EmptyState
      icon={FileQuestion}
      title="This batch item does not exist"
      description="The paper or item may have been excluded, renamed, or removed from the mounted batch. Open the paper table to see what is available."
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Link href="/dashboard" className={buttonVariants()}>
            <Compass data-icon="inline-start" />
            Back to papers
          </Link>
          <Link
            href="/guide"
            className={buttonVariants({ variant: "outline" })}
          >
            Read the guide
          </Link>
        </div>
      }
    />
  )
}
