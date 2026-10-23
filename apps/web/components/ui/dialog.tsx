"use client";

import { cn } from "cn";
import { Dialog as DialogPrimitive } from "radix-ui";
import type * as React from "react";

// shadcn/ui's dialog, cut to the parts the page uses and restyled to the editing room: a surface
// in viewfinder corners over the dimmed page.

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        // Each dialog's text says what it is for; its title names it.
        aria-describedby={undefined}
        className={cn(
          "viewfinder fixed top-1/2 left-1/2 z-50 grid w-[min(460px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-2xl border border-edge bg-linear-to-b from-surface to-card p-6 text-foreground shadow-[0_32px_64px_-24px_rgb(0_0_0/0.9)] outline-none [--cc:rgb(255_255_255/0.32)] [--inset:-9px] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-[0.97] data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-[0.97] max-sm:p-5",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("display text-2xl leading-tight", className)}
      {...props}
    />
  );
}

export { Dialog, DialogContent, DialogTitle };
