import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "../../lib/cn.ts";

/**
 * A pill in two sizes, 48 px and 40 px: amber for the page's one primary action; outlined, a
 * paper pill with an edge that turns ink, for every other action; ink on an amber card.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2.5 rounded-full border-(length:--stroke) font-semibold tracking-normal whitespace-nowrap no-underline transition-[transform,background-color,border-color] duration-250 ease-out select-none hover:-translate-y-px active:translate-y-0 disabled:pointer-events-none disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:size-4.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-amber bg-amber text-ink hover:border-amber-hover hover:bg-amber-hover",
        outline: "border-edge bg-paper text-ink hover:border-ink",
        dark: "border-ink bg-ink text-white hover:border-graphite hover:bg-graphite [&_svg]:text-amber",
      },
      size: {
        default: "h-12 px-6 text-body",
        sm: "h-10 px-4.5 text-small",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonProps = VariantProps<typeof buttonVariants>;

/** A button; `buttonClass` styles a link as one. */
function Button({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<"button"> & ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

function buttonClass(props: ButtonProps = {}): string {
  return buttonVariants(props);
}

export { Button, buttonClass };
