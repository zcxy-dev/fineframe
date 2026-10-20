"use client";

import { useEffect, useState } from "react";
import { formatEstimate } from "../lib/eta.ts";
import type { Messages } from "../lib/i18n/messages.ts";
import { downloadName, progressText } from "../lib/i18n/program.ts";
import type { Job, Stage } from "../lib/jobs.ts";
import { formatBytes, formatClock, formatLength, formatRange } from "../lib/settings.ts";
import styles from "./editor.module.css";
import { useT } from "./I18n.tsx";
import { AlertIcon, CheckIcon } from "./icons.tsx";

const ORDER: Stage[] = ["analyze", "plan", "render", "check"];

type Step = NonNullable<NonNullable<Job["progress"]>["step"]>;

/** The analysis's steps for one file, in the order vework takes them. */
const STEPS: Exclude<Step, "music">[] = [
  "probe",
  "shots",
  "speech",
  "loudness",
  "events",
  "faces",
  "denoise",
  "transcribe",
  "correct",
  "align",
];

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
  const t = useT();
  const words = t.run;
  const running = job.status === "running";
  const elapsed = useElapsed(job.started, job.finished, running);
  const fraction = job.progress?.fraction ?? 0;
  const current = job.progress?.stage;
  const percent = Math.floor(fraction * 100);
  const videos = job.files.filter((file) => file.use === "video").length;
  const photos = job.files.filter((file) => file.use === "image").length;
  const { shorts } = job.settings;
  const short = job.progress?.short;

  return (
    <section className={`${styles.card} ${styles.run}`} aria-label={words.progress}>
      <div className={styles.runHead}>
        <div>
          <h2 className={styles.runTitle}>
            {running ? (shorts ? words.runningShorts : words.running) : words.stopped}
          </h2>
          <p className={styles.runMeta}>
            {shorts
              ? words.shortsFrom(
                  shorts.count,
                  formatRange(shorts.min, shorts.max, t),
                  job.settings.aspect,
                )
              : words.from(
                  formatLength(job.settings.length, t),
                  job.settings.aspect,
                  videos,
                  photos,
                )}
          </p>
        </div>
        <div className={styles.runClock}>
          <span className={styles.percent}>
            {percent}
            <span className={styles.percentSign}>%</span>
          </span>
          <span className={styles.elapsed}>{words.elapsed(formatClock(elapsed))}</span>
          {running && job.finish !== undefined && <TimeLeft finish={job.finish} />}
        </div>
      </div>

      <div
        className={styles.bar}
        role="progressbar"
        aria-label={words.progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className={styles.barFill} style={{ width: `${Math.max(1, fraction * 100)}%` }} />
      </div>

      <p className={styles.message} aria-live="polite">
        {current ? words.doing(words.stages[current].doing) : words.starting}
        <span className={styles.messageText}>
          {short && `${words.short(short.n, short.of)} — `}
          {job.progress?.file && `${job.progress.file} — `}
          {job.progress?.message ? progressText(job.progress.message, t) : words.gettingReady}
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
                <span className={styles.stepName}>{words.stages[stage].name}</span>
                <span className={styles.stepWhat}>{words.stages[stage].what}</span>
              </span>
              <StageTime start={times?.start} end={times?.end} running={active} />
            </li>
          );
        })}
      </ol>

      <AnalysisSteps job={job} />
    </section>
  );
}

/** The time left at the rate the edit has gone, counting down between its lines. */
function TimeLeft({ finish }: { finish: number }) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className={styles.elapsed} title={t.run.estimated}>
      {t.run.approximate(formatEstimate((finish - now) / 1000, t))}
    </span>
  );
}

/** The analysis's steps for the file it is on: done, running or still to come. A step vework
 * had nothing to do for, such as faces in a file without picture, counts as done once it is
 * passed. */
function AnalysisSteps({ job }: { job: Job }) {
  const words = useT().run;
  const running = job.status === "running";
  const stage = job.progress?.stage;
  const analysing = stage === "analyze";
  const at = analysing ? STEPS.indexOf(job.progress?.step as (typeof STEPS)[number]) : -1;
  const passed = stage !== undefined && stage !== "analyze";
  const failed = job.status === "error" && analysing;
  const music = job.progress?.step === "music";
  const shown = STEPS.filter((step) => step !== "correct" || job.settings.correct);
  return (
    <div className={styles.substeps}>
      <p className={styles.substepsHead}>
        {words.analyse}
        {analysing && job.progress?.file && (
          <span className={styles.substepsFile}>
            {music ? words.musicFile : ""}
            {job.progress.file}
          </span>
        )}
      </p>
      <ul className={styles.substepList}>
        {shown.map((step) => {
          const index = STEPS.indexOf(step);
          const state =
            passed || (at >= 0 && index < at)
              ? "done"
              : index === at
                ? failed
                  ? "failed"
                  : running
                    ? "active"
                    : "pending"
                : "pending";
          const count =
            state === "active" && (step === "shots" || step === "transcribe" || step === "align")
              ? job.progress?.message.match(/(\d+\/\d+|\d+%)/)?.[1]
              : undefined;
          return (
            <li key={step} className={styles.substep} data-state={state}>
              <span className={styles.substepDot}>
                {state === "done" ? (
                  <CheckIcon width={10} height={10} />
                ) : state === "failed" ? (
                  <AlertIcon width={10} height={10} />
                ) : null}
              </span>
              <span>{words.steps[step]}</span>
              {count && <span className={styles.substepCount}>{count}</span>}
              <span className={styles.visuallyHidden}>{words.states[state]}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A model or program downloading on its first use: how much has arrived and how long the rest
 * will take. */
export function DownloadView({ download }: { download: NonNullable<Job["download"]> }) {
  const t = useT();
  const words = t.run;
  const { bytes, total, secondsLeft } = download;
  const name = downloadName(download.name, t);
  const percent = Math.floor((bytes / total) * 100);
  return (
    <div className={styles.download}>
      <div className={styles.uploadHead}>
        <span className={styles.downloadName}>{words.downloading(name)}</span>
        <span className={styles.tabular}>{percent}%</span>
      </div>
      <div
        className={styles.bar}
        role="progressbar"
        aria-label={words.downloading(name)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className={styles.barFill} style={{ width: `${(bytes / total) * 100}%` }} />
      </div>
      <p className={styles.help}>
        {t.compose.of(formatBytes(bytes), formatBytes(total))}
        {secondsLeft !== undefined && words.left(formatLeft(secondsLeft, t))}
        {words.firstTime}
      </p>
    </div>
  );
}

/** A wait in `t`'s words: 40 s, 3 min, 1 h 5 min. */
function formatLeft(seconds: number, t: Messages): string {
  const { h, min, s } = t.units;
  if (seconds < 60) return `${Math.max(1, Math.round(seconds / 5) * 5)} ${s}`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60
    ? `${minutes} ${min}`
    : `${Math.floor(minutes / 60)} ${h} ${minutes % 60} ${min}`;
}

function StageTime({ start, end, running }: { start?: number; end?: number; running: boolean }) {
  const seconds = useElapsed(start, end, running);
  if (start === undefined) return <span className={styles.stepTime} />;
  return <span className={styles.stepTime}>{formatClock(seconds)}</span>;
}
