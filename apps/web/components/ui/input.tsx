import { cn } from "cn";
import type * as React from "react";

// shadcn/ui's input, textarea and native select, as the website restyles its input: a white field
// with a hairline edge that turns ink with focus, sized for an editor's panels.

const FIELD =
  "w-full min-w-0 rounded-lg border border-input text-[13px] text-foreground transition-[border-color,box-shadow] duration-200 outline-none placeholder:text-muted-foreground hover:border-foreground/40 focus-visible:border-foreground focus-visible:ring-3 focus-visible:ring-foreground/10 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(FIELD, "h-9 bg-card px-3", className)}
      {...props}
    />
  );
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(FIELD, "min-h-19 resize-y bg-card px-3 py-2 leading-relaxed", className)}
      {...props}
    />
  );
}

/** A native select, for the keyboard and screen readers every system gives it, with a chevron of
 * the page's own. */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        FIELD,
        "chevron h-9 appearance-none pr-9 pl-3 [&>option]:bg-surface",
        className,
      )}
      {...props}
    />
  );
}

export { Input, NativeSelect, Textarea };
