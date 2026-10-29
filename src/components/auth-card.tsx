import type { ReactNode } from "react"

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

type AuthCardProps = {
  title: string
  description: ReactNode
  footer: ReactNode
  children: ReactNode
  className?: string
}

export function AuthCard({
  title,
  description,
  footer,
  children,
  className,
}: AuthCardProps) {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className={cn("w-full max-w-sm", className)}>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
        <CardFooter className="justify-center gap-1 text-sm">
          {footer}
        </CardFooter>
      </Card>
    </div>
  )
}
