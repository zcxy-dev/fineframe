"use client";

import { type RefObject, useEffect, useState } from "react";
import type { Job } from "../lib/jobs.ts";
import { shownPlan } from "../lib/paths.ts";
import { formatClock } from "../lib/settings.ts";
import { jobApi } from "../lib/shorts.ts";
import { HELP } from "../lib/styles.ts";
import { useT } from "./I18n.tsx";

/** Each aspect's width over its height. */
const RATIO: Record<string, number> = { "9:16": 9 / 16, "1:1": 1, "16:9": 16 / 9 };

/** The finished video in the editor's viewer: as large as the stage allows, in viewfinder
 * corners. */
export function Player({ job, video }: { job: Job; video: RefObject<HTMLVideoElement | null> }) {
  const t = useT();
  const aspect = shownPlan(job).aspect;
  const ratio = RATIO[aspect] ?? 16 / 9;
  return (
    <section
      className="relative grid min-h-0 flex-1 place-items-center overflow-hidden bg-well p-8 [container-type:size] max-lg:h-[min(72vh,620px)] max-lg:flex-none max-md:p-5"
      aria-label={t.done.player}
    >
      {/* A faint pool of light behind the picture, as on a monitor in a dark room. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_55%_at_50%_45%,rgb(255_255_255/0.035),transparent_70%)]"
      />
      <div
        className="viewfinder relative animate-in fade-in-0 zoom-in-[0.98] duration-700 [--cc:rgb(255_255_255/0.4)] [--inset:-12px]"
        style={{
          aspectRatio: String(ratio),
          width: `min(100cqw, calc(100cqh * ${ratio}))`,
        }}
      >
        {/* biome-ignore lint/a11y/useMediaCaption: the captions are burned into the picture. */}
        <video
          ref={video}
          className="block size-full rounded-md bg-black shadow-[0_30px_80px_-30px_rgb(0_0_0/0.9)]"
          src={jobApi(job, "video", { v: job.current ?? 1 })}
          controls
          playsInline
          preload="metadata"
        />
      </div>
    </section>
  );
}

/** The video's length, read from its header; null until it is. */
export function useVideoLength(job: Job): number | null {
  const [seconds, setSeconds] = useState<number | null>(null);
  const version = job.current ?? 1;
  const src = jobApi(job, "video", { v: version });
  useEffect(() => {
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => setSeconds(probe.duration);
    probe.src = src;
    return () => {
      probe.onloadedmetadata = null;
      probe.removeAttribute("src");
      probe.load();
    };
  }, [src]);
  return seconds;
}

export function ResultSummary({ job, seconds }: { job: Job; seconds: number | null }) {
  const t = useT();
  return (
    <>
      <p className="mt-1 text-[13px] text-steel tabular-nums">
        {seconds ? formatClock(seconds) : "…"} · {shownPlan(job).aspect}
        {job.result?.captions ? t.done.captions : ""}
      </p>
      {/* Only the first version went without; a later one may have music from the panel. */}
      {job.result?.musicSkipped && (job.current ?? 1) === 1 && (
        <p className={`mt-2 ${HELP}`}>{t.done.musicSkipped}</p>
      )}
      {job.result?.beatsSkipped && (job.current ?? 1) === 1 && (
        <p className={`mt-2 ${HELP}`}>{t.done.beatsSkipped}</p>
      )}
    </>
  );
}
