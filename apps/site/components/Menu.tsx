"use client";

import { type ReactNode, useEffect, useState } from "react";
import { Icon } from "./Icon.tsx";

/**
 * The bar's menu below 1081 px, where its links do not fit: a button that opens them in a
 * panel under the bar. Escape, a link or the button closes it.
 */
export function Menu({
  open: openLabel,
  close: closeLabel,
  children,
}: {
  open: string;
  close: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button
        type="button"
        className="-mr-2 grid size-11 place-items-center rounded-full text-ink min-[1081px]:hidden"
        aria-expanded={open}
        aria-controls="menu"
        aria-label={open ? closeLabel : openLabel}
        onClick={() => setOpen((was) => !was)}
      >
        <Icon name={open ? "close" : "menu"} className="size-6" />
      </button>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: closes the panel when one of its links is followed; the links themselves take the keyboard. */}
      <div
        id="menu"
        hidden={!open}
        className="absolute inset-x-0 top-full border-b bg-ground shadow-raised min-[1081px]:hidden"
        onClick={(event) => (event.target as HTMLElement).closest("a") && setOpen(false)}
      >
        {children}
      </div>
    </>
  );
}
