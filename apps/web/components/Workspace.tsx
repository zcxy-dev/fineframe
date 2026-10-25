import type { ReactNode } from "react";
import { cn } from "../lib/styles.ts";

/**
 * A screen of the editing room: the work in the main pane and a docked panel on the right, each
 * with its own scroll, the panel's action pinned at its foot. Below 1024 px they stack, the panel
 * after the work unless `panelFirst`, as for a failed edit, whose reason and next steps lead.
 */
export function Workspace({
  children,
  panel,
  foot,
  label,
  panelFirst = false,
}: {
  children: ReactNode;
  panel: ReactNode;
  /** The panel's action, pinned below its scroll. */
  foot?: ReactNode;
  /** What the panel is, for assistive tech. */
  label: string;
  panelFirst?: boolean;
}) {
  return (
    <main className="flex flex-col lg:grid lg:h-[calc(100dvh-3.5rem)] lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-h-0 min-w-0 lg:overflow-y-auto">{children}</div>
      <aside
        className={cn(
          "flex min-h-0 flex-col border-l bg-card max-lg:border-t max-lg:border-l-0",
          panelFirst && "max-lg:order-first max-lg:border-t-0 max-lg:border-b",
        )}
        aria-label={label}
      >
        <div className="min-h-0 flex-1 lg:overflow-y-auto">{panel}</div>
        {foot && (
          <div className="flex shrink-0 flex-col gap-2.5 border-t bg-surface px-6 py-4 shadow-[0_-12px_24px_-16px_rgb(12_13_16/0.14)] max-lg:sticky max-lg:bottom-0 max-md:px-4">
            {foot}
          </div>
        )}
      </aside>
    </main>
  );
}
