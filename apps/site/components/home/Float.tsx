"use client";

import { type ReactNode, useEffect, useState } from "react";
import { watch } from "./media.ts";

/**
 * The download button that floats at the bottom of a phone's screen while none of the page's
 * own download buttons (the elements `ids` names) is on screen.
 */
export function Float({ ids, children }: { ids: string[]; children: ReactNode }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const seen = new Set<string>();
    const stops = ids.flatMap((id) => {
      const el = document.getElementById(id);
      if (!el) return [];
      return [
        watch(el, (visible) => {
          if (visible) seen.add(id);
          else seen.delete(id);
          setOn(seen.size === 0);
        }),
      ];
    });
    return () => {
      for (const stop of stops) stop();
    };
  }, [ids]);
  return (
    <div className={on ? "float on" : "float"} inert={!on}>
      {children}
    </div>
  );
}
