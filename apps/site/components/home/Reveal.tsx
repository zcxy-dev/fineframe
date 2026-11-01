"use client";

import { useEffect } from "react";
import { still, watch } from "./media.ts";

/**
 * The home page's entrances, once each: every `[data-reveal]` below the first screen waits
 * (`data-reveal="wait"`, set here, so a page without JavaScript shows it) and rises into place
 * the first time it comes on screen. Under reduced motion nothing waits.
 */
export function Reveal() {
  useEffect(() => {
    if (still()) return;
    const stops: (() => void)[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(".home [data-reveal]")) {
      if (el.getBoundingClientRect().top < innerHeight) continue;
      el.dataset.reveal = "wait";
      const stop = watch(el, (seen) => {
        if (!seen) return;
        el.dataset.reveal = "in";
        stop();
      });
      stops.push(stop);
    }
    return () => {
      for (const stop of stops) stop();
    };
  }, []);
  return null;
}
