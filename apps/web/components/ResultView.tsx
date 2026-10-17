"use client";

import { useEffect, useState } from "react";
import type { Job } from "../lib/jobs.ts";
import { formatClock } from "../lib/settings.ts";
import styles from "./editor.module.css";

/** The finished video in the page's player. */
export function Player({ job }: { job: Job }) {
  const base = `/api/jobs/${job.id}`;
  return (
    <section className={`${styles.card} ${styles.player}`} aria-label="Your edit">
      <div className={styles.screen} data-aspect={job.settings.aspect}>
        {/* biome-ignore lint/a11y/useMediaCaption: the captions are burned into the picture. */}
        <video
          className={styles.video}
          src={`${base}/video`}
          controls
          playsInline
          preload="metadata"
        />
      </div>
    </section>
  );
}

/** The video's length, read from its header. */
function useVideoLength(job: Job): number | null {
  const [seconds, setSeconds] = useState<number | null>(null);
  useEffect(() => {
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => setSeconds(probe.duration);
    probe.src = `/api/jobs/${job.id}/video`;
    return () => {
      probe.onloadedmetadata = null;
      probe.removeAttribute("src");
      probe.load();
    };
  }, [job.id]);
  return seconds;
}

export function ResultSummary({ job }: { job: Job }) {
  const seconds = useVideoLength(job);
  return (
    <p className={styles.resultMeta}>
      {seconds ? formatClock(seconds) : "…"} · {job.settings.aspect}
      {job.result?.captions ? " · captions" : ""}
    </p>
  );
}
