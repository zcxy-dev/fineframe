import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import type * as React from "react";

/** A pill: amber for the primary action, outlined in ink otherwise, ink on light cards. */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2.5 rounded-full border-(length:--stroke) font-semibold tracking-normal whitespace-nowrap no-underline transition-[transform,background-color] duration-250 ease-out outline-none select-none hover:-translate-y-px active:translate-y-0 disabled:pointer-events-none disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:size-4.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-amber bg-amber text-ink hover:border-amber-hover hover:bg-amber-hover",
        outline: "border-ink text-ink hover:bg-paper",
        dark: "border-ink bg-ink text-white hover:border-graphite hover:bg-graphite [&_svg]:text-amber",
      },
      size: {
        default: "h-13 px-6.5 text-base",
        sm: "h-10 px-4.5 text-[15px]",
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
