import { Geist, Geist_Mono } from "next/font/google"
import { Suspense } from "react"

import "./globals.css"
import { TourAutoStart } from "@/components/review/tour-auto-start"
import { ReviewTourProvider } from "@/components/review/tour-provider"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

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
