"use client";

import { type CSSProperties, useEffect, useRef } from "react";
import { clock, still, wait, watch } from "./media.ts";

/** The sample's stretches under its words: `true` kept, `false` the fillers cut out. */
const SEGMENTS: [number, boolean][] = [
  [3, true],
  [2, false],
  [4, true],
  [1, false],
  [3, true],
  [2, false],
  [3, true],
];

/**
 * The cut card's picture: in a sample line the fillers turn red and are struck through, then
 * close up out of the sentence as the stretches under it close and the length counts from
 * 1:12 down to the 1:00 asked for. It plays while on screen; under reduced motion it shows
 * the cut line.
 */
export function CutDemo({
  words,
  sample,
  target,
  result,
}: {
  words: [string, boolean][];
  sample: string;
  target: string;
  result: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const len = useRef<HTMLElement>(null);

  useEffect(() => {
    const card = root.current?.closest(".cut");
    const shown = len.current;
    if (!card || !shown) return;
    if (still()) {
      card.classList.add("marked", "closed");
      shown.textContent = "1:00";
      return;
    }
    let on = false;
    let round = 0;
    const play = async (me: number) => {
      card.classList.remove("marked", "closed");
      shown.textContent = "1:12";
      await wait(1200);
      if (me !== round) return;
      card.classList.add("marked");
      await wait(900);
      if (me !== round) return;
      card.classList.add("closed");
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / 900);
        shown.textContent = clock(72 - 12 * (1 - (1 - p) ** 3));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      await wait(3600);
      if (me === round && on) play(me);
    };
    const stop = watch(card, (seen) => {
      on = seen;
      round++;
      if (seen) play(round);
    });
    return () => {
      round++;
      stop();
    };
  }, []);

  return (
    <div className="ui" ref={root} aria-hidden="true">
      <span className="tag">{sample}</span>
      <div className="words">
        {words.map(([word, filler], i) => (
          <span key={i} className={filler ? "fill" : undefined}>
            <b>{word}</b>
          </span>
        ))}
      </div>
      <div className="segs mini">
        {SEGMENTS.map(([grow, keep], i) => (
          <i key={i} className={keep ? "keep" : "drop"} style={{ "--g": grow } as CSSProperties} />
        ))}
      </div>
      <div className="meter">
        <span>
          {target} <b>1:00</b>
        </span>
        <span>
          {result} <b ref={len}>1:12</b>
        </span>
      </div>
    </div>
  );
}
