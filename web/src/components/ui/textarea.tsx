import * as React from "react"
import { CodeTextarea } from "@/components/CodeTextarea"
import { Toggle } from "@/components/ui/toggle"
import { cn } from "@/lib/utils"

function Textarea({ className, value, defaultValue, onChange, wrap = "soft", disabled, ...props }: React.ComponentProps<"textarea">) {
  const generatedId = React.useId()
  const id = props.id ?? generatedId
  const [draft, setDraft] = React.useState(() => String(defaultValue ?? ""))
  const [showWhitespace, setShowWhitespace] = React.useState(false)
  return (
    <div data-slot="text-editor" className="grid min-w-0 gap-1.5">
      <CodeTextarea
        {...props}
        id={id}
        value={value === undefined ? draft : String(value)}
        wrap={wrap}
        disabled={disabled}
        showWhitespace={showWhitespace}
        className={cn("min-h-16", className)}
        onChange={(event) => {
          if (value === undefined) setDraft(event.target.value)
          onChange?.(event)
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span aria-hidden="true" className={cn("inline-flex items-center gap-1.5", !showWhitespace && "invisible")}>
          <span className="inline-block h-px w-3 bg-muted-foreground/40" />
          空格 <span className="ml-1 font-mono">→</span> Tab
        </span>
        <Toggle size="sm" aria-controls={id} pressed={showWhitespace} onPressedChange={setShowWhitespace} disabled={disabled} className="ml-auto px-2 text-xs">
          显示空白字符
        </Toggle>
      </div>
    </div>
  )
}

export { Textarea }
