"use client";

import { ArrowDownToLine } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "./I18n.tsx";
import { Button } from "./ui/button.tsx";

/** What the desktop app says of its update: downloaded and ready to install on a restart, or, on
 * a Mac, which cannot install it by itself, out and downloadable from `url`. */
type Update =
  | { kind: "ready"; version: string }
  | { kind: "available"; version: string; url: string };

/** The desktop app's update, which it sets on the window and announces with this event. */
const EVENT = "fineframe:update";
const current = () => (window as { fineframeUpdate?: Update }).fineframeUpdate ?? null;

/** A small notice of the desktop app's update in the bottom left corner, clear of the editor's
 * Apply, until dismissed; nothing elsewhere. */
export function UpdateNotice() {
  const t = useT();
  const [update, setUpdate] = useState<Update | null>(null);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    setUpdate(current());
    const changed = () => {
      setUpdate(current());
      setDismissed(false);
    };
    window.addEventListener(EVENT, changed);
    return () => window.removeEventListener(EVENT, changed);
  }, []);
  if (!update || dismissed) return null;
  return (
    <div
      className="fixed bottom-4 left-4 z-40 flex max-w-[calc(100vw-2rem)] animate-in items-center gap-3 rounded-xl border border-edge bg-surface py-2 pr-3 pl-3.5 text-[13px] shadow-[0_24px_48px_-16px_rgb(0_0_0/0.8)] duration-500 fade-in-0 slide-in-from-bottom-2"
      role="status"
    >
      <ArrowDownToLine className="size-4 shrink-0 text-primary" aria-hidden="true" />
      <span>
        {update.kind === "ready"
          ? t.update.ready(update.version)
          : t.update.available(update.version)}
      </span>
      <Button asChild size="sm">
        {update.kind === "ready" ? (
          // The app restarts into the update when the window goes here.
          <a href="fineframe:restart">{t.update.restart}</a>
        ) : (
          <a href={update.url} target="_blank" rel="noreferrer">
            {t.update.download}
          </a>
        )}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setDismissed(true)}>
        {t.update.dismiss}
      </Button>
    </div>
  );
}
