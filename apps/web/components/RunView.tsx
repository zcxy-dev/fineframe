"use client";

import { useEffect, useState } from "react";
import type { Job, Stage } from "../lib/jobs.ts";
import { formatBytes, formatClock, formatLength } from "../lib/settings.ts";
import styles from "./editor.module.css";
import { AlertIcon, CheckIcon } from "./icons.tsx";

const STAGE_TEXT: Record<Stage, { name: string; doing: string; what: string }> = {
  analyze: { name: "Analyse", doing: "Analysing", what: "Shots, speech and words in each file" },
  plan: { name: "Plan", doing: "Planning", what: "The best takes, cut to the length" },
  render: { name: "Render", doing: "Rendering", what: "Cuts, framing, colour and sound" },
  check: { name: "Check", doing: "Checking", what: "Every cut reviewed and fixed" },
};
const ORDER: Stage[] = ["analyze", "plan", "render", "check"];

/** Seconds since `start`, kept current while `running`. */
function useElapsed(start: number | undefined, end: number | undefined, running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  if (start === undefined) return 0;
  return ((end ?? (running ? now : start)) - start) / 1000;
}

/** The edit as it runs: its stages, how far along it is and what it is doing. */
export function RunView({ job }: { job: Job }) {
  const running = job.status === "running";
  const elapsed = useElapsed(job.started, job.finished, running);
  const fraction = job.progress?.fraction ?? 0;
  const current = job.progress?.stage;
  const percent = Math.floor(fraction * 100);
  const videos = job.files.filter((file) => file.use === "video").length;
  const photos = job.files.filter((file) => file.use === "image").length;

  return (
    <section className={`${styles.card} ${styles.run}`} aria-label="Progress">
      <div className={styles.runHead}>
        <div>
          <h2 className={styles.runTitle}>{running ? "Making your edit" : "Stopped"}</h2>
          <p className={styles.runMeta}>
            {formatLength(job.settings.length)} · {job.settings.aspect} · from {videos}{" "}
            {videos === 1 ? "video" : "videos"}
            {photos > 0 && ` and ${photos} ${photos === 1 ? "photo" : "photos"}`}
          </p>
        </div>
        <div className={styles.runClock}>
          <span className={styles.percent}>
            {percent}
            <span className={styles.percentSign}>%</span>
          </span>
          <span className={styles.elapsed}>{formatClock(elapsed)} elapsed</span>
        </div>
      </div>

      <div
        className={styles.bar}
        role="progressbar"
        aria-label="Progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className={styles.barFill} style={{ width: `${Math.max(1, fraction * 100)}%` }} />
      </div>

      <p className={styles.message} aria-live="polite">
        {current ? `${STAGE_TEXT[current].doing}: ` : "Starting: "}
        <span className={styles.messageText}>
          {job.progress?.file && `${job.progress.file} — `}
          {job.progress?.message ?? "getting ready"}
        </span>
      </p>

      {job.download && running && <DownloadView download={job.download} />}

      <ol className={styles.steps}>
        {ORDER.map((stage, i) => {
          const times = job.stages[stage];
          const active = stage === current && running;
          const done = Boolean(times?.end) || (current && ORDER.indexOf(current) > i);
          const failed = stage === current && job.status === "error";
          const state = active ? "active" : failed ? "failed" : done ? "done" : "pending";
          return (
            <li key={stage} className={styles.step} data-state={state}>
              <span className={styles.stepDot}>
                {state === "done" ? (
                  <CheckIcon width={14} height={14} />
                ) : state === "failed" ? (
                  <AlertIcon width={14} height={14} />
                ) : (
                  i + 1
                )}
              </span>
              <span className={styles.stepText}>
                <span className={styles.stepName}>{STAGE_TEXT[stage].name}</span>
                <span className={styles.stepWhat}>{STAGE_TEXT[stage].what}</span>
              </span>
              <StageTime start={times?.start} end={times?.end} running={active} />
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** A model or program downloading on its first use: how much has arrived and how long the rest
 * will take. */
export function DownloadView({ download }: { download: NonNullable<Job["download"]> }) {
  const { name, bytes, total, secondsLeft } = download;
  const percent = Math.floor((bytes / total) * 100);
  return (
    <div className={styles.download}>
      <div className={styles.uploadHead}>
        <span className={styles.downloadName}>Downloading {name}</span>
        <span className={styles.tabular}>{percent}%</span>
      </div>
      <div
        className={styles.bar}
        role="progressbar"
        aria-label={`Downloading ${name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className={styles.barFill} style={{ width: `${(bytes / total) * 100}%` }} />
      </div>
      <p className={styles.help}>
        {formatBytes(bytes)} of {formatBytes(total)}
        {secondsLeft !== undefined && ` · about ${formatLeft(secondsLeft)} left`} · only the first
        time it is used
      </p>
    </div>
  );
}

/** A wait in words: 40 s, 3 min, 1 h 5 min. */
function formatLeft(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds / 5) * 5)} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function StageTime({ start, end, running }: { start?: number; end?: number; running: boolean }) {
  const seconds = useElapsed(start, end, running);
  if (start === undefined) return <span className={styles.stepTime} />;
  return <span className={styles.stepTime}>{formatClock(seconds)}</span>;
}
