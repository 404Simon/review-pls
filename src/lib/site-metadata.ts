import type { Metadata } from "next"

export const SITE_NAME = "review-pls"
export const SITE_INVITE =
  "Someone invited you to review a lot of LLM-generated content."
export const SITE_DESCRIPTION =
  "Claim an item, check the evidence, and make the call."

const FALLBACK_SITE_URL = "http://localhost:3000"

/**
 * Public base URL used to resolve Open Graph page URLs.
 *
 * `BETTER_AUTH_URL` is already the canonical deployment origin; the fallback
 * only keeps local builds and tests working when it is not set.
 */
export function getSiteUrl(): URL {
  try {
    return new URL(process.env.BETTER_AUTH_URL ?? FALLBACK_SITE_URL)
  } catch {
    return new URL(FALLBACK_SITE_URL)
  }
}

/** Compose the title shown in link previews, where Next does not apply templates. */
export function shareTitle(title: string): string {
  return title === SITE_NAME ? SITE_NAME : `${title} · ${SITE_NAME}`
}

interface PageMetadataOptions {
  title: string
  description?: string
  /** Route path used as the canonical Open Graph URL, for example `/guide`. */
  path?: string
  /**
   * Title shown in link previews when the tab title would read poorly out of
   * context, for example an invite landing page.
   */
  previewTitle?: string
}

/**
 * Build the page title plus the Open Graph and Twitter fields that social
 * previews need. Site-wide values (card type, site name) come from the root
 * layout.
 */
export function pageMetadata({
  title,
  description = SITE_DESCRIPTION,
  path,
  previewTitle,
}: PageMetadataOptions): Metadata {
  const openGraphTitle = previewTitle ?? shareTitle(title)

  return {
    title,
    description,
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: openGraphTitle,
      description,
      ...(path ? { url: path } : {}),
    },
    twitter: {
      card: "summary",
      title: openGraphTitle,
      description,
    },
  }
}
