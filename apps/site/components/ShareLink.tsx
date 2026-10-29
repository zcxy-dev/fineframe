"use client";

import { useState } from "react";
import { buttonClass } from "./ui/button.tsx";

/** Sends this page's address on: the system's share sheet, or the clipboard where there is none. */
export function ShareLink({ label, copied }: { label: string; copied: string }) {
  const [done, setDone] = useState(false);
  async function share() {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ url }).catch(() => undefined);
    } else {
      await navigator.clipboard.writeText(url);
      setDone(true);
    }
  }
  return (
    <button type="button" className={buttonClass({ variant: "outline" })} onClick={share}>
      <span aria-live="polite">{done ? copied : label}</span>
    </button>
  );
}
