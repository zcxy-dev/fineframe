"use client";

import { type RefObject, useEffect, useState } from "react";
import type { Job } from "../lib/jobs.ts";
import { shownPlan } from "../lib/paths.ts";
import { formatClock } from "../lib/settings.ts";
import styles from "./editor.module.css";
import { useT } from "./I18n.tsx";

/** The finished video in the page's player. */
export function Player({ job, video }: { job: Job; video: RefObject<HTMLVideoElement | null> }) {
  const t = useT();
  const base = `/api/jobs/${job.id}`;
  return (
    <section className={`${styles.card} ${styles.player}`} aria-label={t.done.player}>
      <div className={styles.screen} data-aspect={shownPlan(job).aspect}>
        {/* biome-ignore lint/a11y/useMediaCaption: the captions are burned into the picture. */}
        <video
          ref={video}
          className={styles.video}
          src={`${base}/video?v=${job.current ?? 1}`}
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
  useEffect(() => {
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => setSeconds(probe.duration);
    probe.src = `/api/jobs/${job.id}/video?v=${version}`;
    return () => {
      probe.onloadedmetadata = null;
      probe.removeAttribute("src");
      probe.load();
    };
  }, [job.id, version]);
  return seconds;
}

export function ResultSummary({ job, seconds }: { job: Job; seconds: number | null }) {
  const t = useT();
  return (
    <p className={styles.resultMeta}>
      {seconds ? formatClock(seconds) : "…"} · {shownPlan(job).aspect}
      {job.result?.captions ? t.done.captions : ""}
    </p>
  );
}
