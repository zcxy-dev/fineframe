"use client";

import { cn } from "cn";
import { Tabs as TabsPrimitive } from "radix-ui";
import type * as React from "react";

// shadcn/ui's tabs in their line style, restyled to the editing room: each tab an icon over its
// name, the chosen one in steel with a steel line under it, as the website's tabs are.

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
      className={cn("flex shrink-0 items-stretch border-b px-2", className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative flex min-w-0 flex-1 flex-col items-center gap-1 px-1 pt-2.5 pb-2 text-[11px] leading-none font-medium whitespace-nowrap text-muted-foreground transition-colors duration-150 outline-none hover:text-foreground focus-visible:rounded-md focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary data-active:text-foreground [&_svg]:size-4.5 [&_svg]:shrink-0",
        "after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:origin-center after:scale-x-0 after:rounded-full after:bg-foreground after:transition-transform after:duration-300 after:ease-(--ease-cut) data-active:after:scale-x-100",
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
