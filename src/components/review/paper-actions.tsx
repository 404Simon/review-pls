import { ExternalLink, FileText, Folder } from "lucide-react"
import Link from "next/link"

import { GithubIcon } from "@/components/review/github-icon"
import { buttonVariants } from "@/components/ui/button"
import { githubTreeUrl } from "@/lib/review/github"
import type { CodeRepoManifest } from "@/lib/review/types"

/**
 * Shared PDF and repository actions. Both the paper page and the item page use
 * the same compact row so the two views stay consistent.
 */
export function PaperActions({
  paperPdfUrl,
  repositories,
  filesBase,
}: {
  paperPdfUrl: string
  repositories: readonly CodeRepoManifest[]
  filesBase: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href={`${paperPdfUrl}#zoom=page-width`}
        target="_blank"
        rel="noreferrer noopener"
        className={buttonVariants({ size: "sm" })}
      >
        <FileText data-icon="inline-start" />
        Open PDF
      </a>
      {repositories.map((repo) => {
        const githubUrl =
          repo.role === "repository"
            ? githubTreeUrl({
                name: repo.name,
                url: repo.url,
                commit: repo.commit,
              })
            : null
        const filesUrl = `${filesBase}/${repo.dir
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`
        return githubUrl ? (
          <a
            key={repo.name}
            href={githubUrl}
            target="_blank"
            rel="noreferrer noopener"
            title={`Open ${repo.name} on GitHub`}
            aria-label={`Open ${repo.name} on GitHub`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <GithubIcon data-icon="inline-start" />
            <span className="max-w-56 truncate">{repo.name}</span>
            <ExternalLink data-icon="inline-end" className="size-3" />
          </a>
        ) : (
          <Link
            key={repo.name}
            href={filesUrl}
            title={`Browse ${repo.name} files`}
            aria-label={`Browse ${repo.name} files`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Folder data-icon="inline-start" />
            <span className="max-w-56 truncate">{repo.name}</span>
          </Link>
        )
      })}
    </div>
  )
}
