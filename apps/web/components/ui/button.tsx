import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";
import type * as React from "react";

// shadcn/ui's button, as the website restyles it, sized for an editor's panels.

const buttonVariants = cva(
  "group/button sheen inline-flex shrink-0 items-center justify-center gap-2 rounded-[10px] border border-transparent bg-clip-padding text-[13px] font-semibold whitespace-nowrap no-underline transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-(--ease-cut) outline-none select-none hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:translate-y-px disabled:pointer-events-none disabled:opacity-50 motion-reduce:hover:translate-y-0 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-primary bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.4),0_10px_28px_-12px_rgb(255_181_71/0.55)] [--sheen:0.55] hover:border-amber-hover hover:bg-amber-hover disabled:border-raised disabled:bg-raised disabled:text-muted-foreground disabled:opacity-100 disabled:shadow-none",
        outline: "border-edge bg-secondary text-foreground hover:border-white/30 hover:bg-white/8",
        ghost: "text-steel hover:bg-accent hover:text-foreground",
        link: "rounded-sm font-medium text-steel underline decoration-edge underline-offset-[3px] hover:translate-y-0 hover:text-foreground hover:decoration-primary",
        danger:
          "border-destructive/70 bg-destructive/10 text-destructive hover:border-destructive hover:bg-destructive/15",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-11 px-5 text-sm",
        icon: "size-8 rounded-lg",
        inline: "h-auto rounded-sm px-0 py-0.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
