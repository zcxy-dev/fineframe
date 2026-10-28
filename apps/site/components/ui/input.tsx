import { cn } from "cn";
import type * as React from "react";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "h-12 w-full min-w-0 rounded-xl border-(length:--stroke) border-line bg-paper px-4 text-base text-ink transition-[border-color] duration-200 outline-none placeholder:text-ink-3 hover:border-ink-3 focus-visible:border-ink focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-cut",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
