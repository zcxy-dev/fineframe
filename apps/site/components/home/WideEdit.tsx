"use client";

import { type CSSProperties, type ReactNode, useEffect, useRef } from "react";
import { loop } from "./media.ts";

/** A deterministic scatter for the timeline's clips to fly in from, one after another. */
function scatter(): () => CSSProperties {
  let seed = 7;
  let order = 0;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  return () =>
    ({
      "--dx": `${Math.round((rnd() - 0.5) * 520)}px`,
      "--dy": `${Math.round(60 + rnd() * 240)}px`,
      "--rot": `${Math.round((rnd() - 0.5) * 30)}deg`,
      "--delay": `${(order++ * 0.03).toFixed(2)}s`,
    }) as CSSProperties;
}

/**
 * The YouTube section's edit: its 16:9 player, and the edit's timeline under it, whose clips
 * land on their tracks the first time it comes on screen and whose red playhead runs with the
 * video.
 */
export function WideEdit({
  tracks,
  name,
  nameTitle,
  spec,
}: {
  tracks: [string, string, string, string];
  name: string;
  nameTitle: string;
  spec: ReactNode;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const playhead = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const v = video.current;
    const ph = playhead.current;
    if (!v || !ph) return;
    const stop = loop(v);
    const move = () => {
      if (v.duration) ph.style.setProperty("--t", (v.currentTime / v.duration).toFixed(4));
    };
    v.addEventListener("timeupdate", move);
    return () => {
      stop();
      v.removeEventListener("timeupdate", move);
    };
  }, []);

  const at = scatter();
  const clips = (kind: string, items: [number, string?][]) =>
    items.map(([grow, label = ""], i) => (
      <i key={i} className={`clip ${kind}`} style={{ flex: grow, ...at() }}>
        {label}
      </i>
    ));
  return (
    <div className="ytgrid">
      <div>
        <figure className="player" data-reveal>
          <video
            ref={video}
            muted
            playsInline
            loop
            preload="none"
            data-src="/media/wide.mp4"
            data-src-sm="/media/wide-sm.mp4"
            data-sm-w="960"
            data-poster="/media/wide.webp"
            width={1920}
            height={1080}
            aria-label={nameTitle}
          />
        </figure>
      </div>
      {spec}
      <div className="tl" aria-hidden="true" data-reveal>
        <div className="ph" ref={playhead} />
        <div className="row">
          <span className="tk">{tracks[0]}</span>
          <div className="lane">{clips("v", [[6], [3], [5], [2], [4], [3], [5]])}</div>
        </div>
        <div className="row">
          <span className="tk">{tracks[1]}</span>
          <div className="lane">
            {clips(
              "c",
              Array.from({ length: 16 }, (_, i): [number] => [1 + (i % 3)]),
            )}
          </div>
        </div>
        <div className="row">
          <span className="tk">{tracks[2]}</span>
          <div className="lane gap">{clips("n", [[3, nameTitle], [6], [3, name], [8]])}</div>
        </div>
        <div className="row">
          <span className="tk">{tracks[3]}</span>
          <div className="lane">{clips("m", [[1]])}</div>
        </div>
      </div>
    </div>
  );
}
