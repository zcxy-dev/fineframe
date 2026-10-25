"use client";

import { TriangleAlert } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { explain } from "../lib/fixes.ts";
import { cn } from "../lib/styles.ts";
import { useT } from "./I18n.tsx";

/** Something that failed, as a person reads it: what happened and what to do, with the program's
 * own message behind "Show details". `fallback` says what failed when the message cannot. */
export function ErrorNote({
  message,
  fallback,
  children,
  className,
}: {
  message: string;
  fallback: string;
  /** Actions that recover, under the explanation. */
  children?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const t = useT();
  const { summary, next, details } = explain(message, fallback, t);
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-xl border border-destructive/45 bg-destructive/[0.06] px-3.5 py-3 text-[13px] leading-normal [overflow-wrap:anywhere] animate-in fade-in-0 slide-in-from-top-1 duration-300",
        className,
      )}
      role="alert"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
      <div className="flex min-w-0 flex-col items-start gap-1.5">
        <p className="font-semibold text-foreground">{summary}</p>
        {next && <p className="text-steel">{next}</p>}
        {details && (
          <>
            <button
              type="button"
              className="text-steel underline decoration-edge underline-offset-2 hover:text-foreground hover:decoration-foreground"
              aria-expanded={open}
              aria-controls={id}
              onClick={() => setOpen(!open)}
            >
              {open ? t.errors.hide : t.errors.show}
            </button>
            {/* The program's own message, for a bug report: selectable, wrapped, never a local
                path. */}
            <pre
              id={id}
              className="mt-1 max-h-40 self-stretch overflow-auto rounded-lg border bg-well px-2.5 py-2 font-mono text-xs leading-normal whitespace-pre-wrap text-steel [overflow-wrap:anywhere]"
              hidden={!open}
            >
              {details}
            </pre>
          </>
        )}
        {children}
      </div>
    </div>
  );
}
