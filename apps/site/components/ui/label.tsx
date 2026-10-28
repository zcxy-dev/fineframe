import { cn } from "cn";
import type * as React from "react";

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as a child.
    <label className={cn("grid gap-2 text-sm font-semibold text-ink", className)} {...props} />
  );
}

export { Label };
