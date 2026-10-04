import * as React from "react"

import { cn } from "shadcn/lib/utils"

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[60px] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base shadow-sm transition-colors placeholder:text-muted-foreground hover:border-slate-400 focus-visible:border-[#185e9c]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#185e9c]/15 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-50 md:text-sm",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }
