import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Suspense } from "react"

import "./globals.css"
import { TourAutoStart } from "@/components/review/tour-auto-start"
import { ReviewTourProvider } from "@/components/review/tour-provider"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import {
  getSiteUrl,
  SITE_DESCRIPTION,
  SITE_INVITE,
  SITE_NAME,
} from "@/lib/site-metadata"
import { cn } from "@/lib/utils"

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  title: {
    default: SITE_NAME,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_INVITE,
    description: SITE_DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary",
    title: SITE_INVITE,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: false,
    follow: false,
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        geist.variable
      )}
    >
      <body>
        <ThemeProvider>
          <ReviewTourProvider>
            <TooltipProvider>{children}</TooltipProvider>
            <Suspense fallback={null}>
              <TourAutoStart />
            </Suspense>
          </ReviewTourProvider>
          <Toaster richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  )
}
