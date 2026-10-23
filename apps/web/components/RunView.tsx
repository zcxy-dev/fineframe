"use client";

import { Check, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { formatEstimate } from "../lib/eta.ts";
import type { Messages } from "../lib/i18n/messages.ts";
import { downloadName, progressText } from "../lib/i18n/program.ts";
import type { Job, Stage } from "../lib/jobs.ts";
import { formatBytes, formatClock, formatLength, formatRange } from "../lib/settings.ts";
import { cn, HELP, META, SLUG, TITLE } from "../lib/styles.ts";
import { useT } from "./I18n.tsx";
import { NumberTicker } from "./ui/number-ticker.tsx";
import { TextAnimate } from "./ui/text-animate.tsx";

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

/** How many clips the progress timeline is built of. */
const CLIPS = 48;

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

/** A thin bar: an amber line along a hairline track, for an upload, a download or a render. */
export function Bar({ fraction, className }: { fraction: number; className?: string }) {
  return (
    <div className={cn("relative h-1 overflow-hidden rounded-full bg-white/8", className)}>
      <div
        className="absolute inset-y-0 left-0 max-w-full rounded-full bg-primary transition-[width] duration-700 ease-(--ease-cut)"
        style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }}
      />
    </div>
  );
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
  const stopped = job.status === "error" || job.status === "cancelled";

  return (
    <section
      className="flex flex-col gap-7 px-10 py-9 max-md:px-4 max-md:py-6"
      aria-label={words.progress}
    >
      <div className="flex items-end justify-between gap-6 max-sm:flex-col max-sm:items-start">
        <div className="min-w-0">
          <TextAnimate
            key={running ? "running" : "stopped"}
            as="h2"
            by="word"
            animation="caption"
            startOnView={false}
            className={TITLE}
          >
            {running ? (shorts ? words.runningShorts : words.running) : words.stopped}
          </TextAnimate>
          <p className="mt-2 text-sm text-steel tabular-nums">
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
        <div className="flex shrink-0 flex-col items-end gap-0.5 max-sm:items-start">
          <span className="display text-5xl leading-none tabular-nums">
            <NumberTicker value={percent} />
            <span className="ml-0.5 text-2xl text-muted-foreground">%</span>
          </span>
          <span className={META}>{words.elapsed(formatClock(elapsed))}</span>
          {running && job.finish !== undefined && <TimeLeft finish={job.finish} />}
        </div>
      </div>

      <Timeline fraction={fraction} running={running} stopped={stopped} label={words.progress} />

      <p className="min-h-[1.5em] text-sm font-medium [overflow-wrap:anywhere]" aria-live="polite">
        {current ? words.doing(words.stages[current].doing) : words.starting}
        <span className="font-normal text-steel">
          {short && `${words.short(short.n, short.of)} — `}
          {job.progress?.file && `${job.progress.file} — `}
          {job.progress?.message ? progressText(job.progress.message, t) : words.gettingReady}
        </span>
      </p>

      {job.download && running && <DownloadView download={job.download} />}

      <ol
        className={cn(
          "m-0 grid list-none grid-cols-4 gap-px overflow-hidden rounded-xl border bg-border p-0 max-lg:grid-cols-2 max-sm:grid-cols-1",
          stopped && "opacity-60",
        )}
      >
        {ORDER.map((stage, i) => {
          const times = job.stages[stage];
          const active = stage === current && running;
          const done = Boolean(times?.end) || (current && ORDER.indexOf(current) > i);
          const failed = stage === current && job.status === "error";
          const state = active ? "active" : failed ? "failed" : done ? "done" : "pending";
          return (
            <li
              key={stage}
              className={cn(
                "relative flex flex-col gap-2.5 bg-card px-4 pt-3.5 pb-4 transition-colors duration-500",
                state === "active" && "bg-surface",
              )}
              data-state={state}
            >
              {/* The live stage's amber line along its top edge, drawn in as it starts. */}
              <span
                aria-hidden="true"
                className={cn(
                  "absolute inset-x-0 top-0 h-0.5 origin-left scale-x-0 transition-transform duration-700 ease-(--ease-cut)",
                  state === "active" && "scale-x-100 bg-primary",
                  state === "failed" && "scale-x-100 bg-destructive",
                )}
              />
              <span
                className={cn(
                  "grid size-6 place-items-center rounded-md border border-edge text-xs font-semibold text-muted-foreground tabular-nums [&_svg]:size-3.5",
                  state === "active" && "border-primary text-primary",
                  state === "done" && "border-success/60 text-success",
                  state === "failed" && "border-destructive text-destructive",
                )}
              >
                {state === "done" ? (
                  <Check aria-hidden="true" />
                ) : state === "failed" ? (
                  <TriangleAlert aria-hidden="true" />
                ) : (
                  i + 1
                )}
              </span>
              <span className="flex flex-col gap-0.5">
                <span
                  className={cn("text-[13px] font-semibold", state === "pending" && "text-steel")}
                >
                  {words.stages[stage].name}
                </span>
                <span className="text-xs leading-snug text-muted-foreground">
                  {words.stages[stage].what}
                </span>
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

/**
 * The edit as a timeline building up: a ruler, and a track of clips that land one after another
 * as the edit gets further, with the amber playhead at its edge. A stopped edit's track steps back.
 */
function Timeline({
  fraction,
  running,
  stopped,
  label,
}: {
  fraction: number;
  running: boolean;
  stopped: boolean;
  label: string;
}) {
  const percent = Math.floor(fraction * 100);
  const filled = Math.floor(Math.max(0, Math.min(1, fraction)) * CLIPS);
  return (
    <div
      className={cn("relative", stopped && "opacity-60")}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <div className="ruler h-3" aria-hidden="true" />
      <div className="mt-1.5 flex h-12 gap-[3px]" aria-hidden="true">
        {Array.from({ length: CLIPS }, (_, i) =>
          i < filled ? (
            <span
              // A new key when it fills, so the clip lands with its animation.
              // biome-ignore lint/suspicious/noArrayIndexKey: the clips are places on the track.
              key={`on-${i}`}
              className="wave-keep h-full flex-1 origin-bottom animate-clip rounded-[3px] bg-raised shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]"
            />
          ) : (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: the clips are places on the track.
              key={`off-${i}`}
              className="wave-dim h-full flex-1 rounded-[3px] opacity-50"
            />
          ),
        )}
      </div>
      <span
        aria-hidden="true"
        className={cn(
          "absolute -top-1 bottom-0 w-0.5 -translate-x-1/2 rounded-full transition-[left] duration-700 ease-(--ease-cut) before:absolute before:-top-0.5 before:left-1/2 before:size-2.5 before:-translate-x-1/2 before:rotate-45 before:rounded-[2px]",
          stopped ? "bg-destructive before:bg-destructive" : "bg-primary before:bg-primary",
          running && "shadow-[0_0_12px_rgb(255_181_71/0.6)]",
        )}
        style={{ left: `${(filled / CLIPS) * 100}%` }}
      />
    </div>
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
    <span className={META} title={t.run.estimated}>
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
  const stopped = job.status === "error" || job.status === "cancelled";
  return (
    <div className={cn("flex flex-col gap-3", stopped && "opacity-60")}>
      <p className={cn(SLUG, "flex items-baseline gap-2")}>
        {words.analyse}
        {analysing && job.progress?.file && (
          <span className="min-w-0 text-xs font-normal tracking-normal text-muted-foreground normal-case [overflow-wrap:anywhere]">
            {music ? words.musicFile : ""}
            {job.progress.file}
          </span>
        )}
      </p>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-x-3 gap-y-2 p-0">
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
            <li
              key={step}
              className={cn(
                "flex items-center gap-2 text-xs text-steel",
                state === "pending" && "text-muted-foreground",
                state === "active" && "font-semibold text-foreground",
              )}
            >
              <span
                className={cn(
                  "grid size-3.5 shrink-0 place-items-center rounded-[4px] border border-edge [&_svg]:size-2.5",
                  state === "active" && "border-primary bg-primary motion-safe:animate-pulse",
                  state === "done" && "border-success/60 text-success",
                  state === "failed" && "border-destructive text-destructive",
                )}
              >
                {state === "done" ? (
                  <Check aria-hidden="true" />
                ) : state === "failed" ? (
                  <TriangleAlert aria-hidden="true" />
                ) : null}
              </span>
              <span>{words.steps[step]}</span>
              {count && (
                <span className="font-normal text-muted-foreground tabular-nums">{count}</span>
              )}
              <span className="sr-only">{words.states[state]}</span>
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
  const { bytes, total, secondsLeft, bytesPerSecond } = download;
  const name = downloadName(download.name, t);
  const percent = Math.floor((bytes / total) * 100);
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border bg-well p-3.5 animate-in fade-in-0 duration-300">
      <div className="flex justify-between gap-3 text-[13px] font-medium">
        <span className="min-w-0 [overflow-wrap:anywhere]">{words.downloading(name)}</span>
        <span className="tabular-nums">{percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={words.downloading(name)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <Bar fraction={bytes / total} />
      </div>
      <p className={HELP}>
        {t.compose.of(formatBytes(bytes), formatBytes(total))}
        {bytesPerSecond !== undefined && words.speed(formatBytes(bytesPerSecond))}
        {secondsLeft !== undefined && words.left(formatLeft(secondsLeft, t))}
        {!download.video && words.firstTime}
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
  return (
    <span className="mt-auto min-h-[1.2em] text-xs text-steel tabular-nums">
      {start === undefined ? null : formatClock(seconds)}
    </span>
  );
}
