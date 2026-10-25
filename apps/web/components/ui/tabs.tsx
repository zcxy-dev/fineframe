"use client";

import { cn } from "cn";
import { Tabs as TabsPrimitive } from "radix-ui";
import type * as React from "react";

// shadcn/ui's tabs in their line style, restyled to direction A: each tab its name, the chosen one
// in ink with an ink line under it.

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex min-h-0 flex-col", className)}
      {...props}
    />
  );
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "flex shrink-0 items-stretch overflow-x-auto border-b px-4 [scrollbar-width:none] max-md:px-2",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative flex min-w-fit flex-1 items-center justify-center px-1.5 py-3.5 text-[13px] leading-none font-medium whitespace-nowrap text-muted-foreground transition-colors duration-150 outline-none hover:text-foreground focus-visible:rounded-md focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring data-active:font-semibold data-active:text-foreground",
        "after:absolute after:inset-x-1.5 after:bottom-0 after:h-0.5 after:origin-center after:scale-x-0 after:rounded-full after:bg-foreground after:transition-transform after:duration-300 after:ease-(--ease-cut) data-active:after:scale-x-100",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(
        "min-h-0 flex-1 overflow-y-auto outline-none data-active:animate-in data-active:fade-in-0 data-active:duration-200",
        className,
      )}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
