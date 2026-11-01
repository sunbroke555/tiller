import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import type { CSSProperties } from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

import { useTheme } from "@/theme/ThemeProvider"

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolved } = useTheme()

  return (
    <Sonner
      theme={resolved === "dark" ? "dark" : "light"}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4 text-success-strong" />,
        info: <InfoIcon className="size-4 text-info" />,
        warning: <TriangleAlertIcon className="size-4 text-warning-strong" />,
        error: <OctagonXIcon className="size-4 text-destructive" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      toastOptions={{ classNames: { toast: "surface-strong !rounded-2xl" } }}
      style={
        {
          "--normal-bg": "var(--glass-strong)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--glass-border)",
          "--border-radius": "calc(var(--radius) + 2px)",
        } as CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
