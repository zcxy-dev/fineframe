import type * as React from "react";
import { cn } from "../../lib/cn.ts";

/**
 * A field: an edge at 3:1 on paper, ink while hovered or focused, and the site's focus ring
 * around it while the keyboard is on it.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "h-12 w-full min-w-0 rounded-field border-(length:--stroke) border-edge bg-paper px-4 text-body text-ink transition-[border-color] duration-200 placeholder:text-ink-3 hover:border-ink focus-visible:border-ink focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-cut",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
