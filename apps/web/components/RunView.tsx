"use client";

import { Check, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatEstimate } from "../lib/eta.ts";
import type { Messages } from "../lib/i18n/messages.ts";
import { downloadName, progressText } from "../lib/i18n/program.ts";
import type { Job, Stage } from "../lib/jobs.ts";
import { formatBytes, formatClock, formatLength, formatRange } from "../lib/settings.ts";
import { analysisSteps } from "../lib/steps.ts";
import { cn, HELP, META, SLUG, TITLE } from "../lib/styles.ts";
import { useT } from "./I18n.tsx";
import { NumberTicker } from "./ui/number-ticker.tsx";

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

/** A thin bar: an ink line along a hairline track, for an upload, a download or a render. */
export function Bar({ fraction, className }: { fraction: number; className?: string }) {
  return (
    <div className={cn("relative h-1 overflow-hidden rounded-full bg-border", className)}>
      <div
        className="absolute inset-y-0 left-0 max-w-full rounded-full bg-foreground transition-[width] duration-700 ease-(--ease-cut)"
        style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }}
      />
    </div>
  );
}

/** The bar's share of each stage after the analysis, as the edit splits it
 * (packages/engine/src/edit/edit.ts), and the analysis's when no file was analysed before. */
const SHARES: Record<Exclude<Stage, "analyze">, number> = { plan: 0.3, render: 0.3, check: 0.4 };
const ANALYZE_SHARE = 0.9;
/** How many status lines the run prints before the oldest scrolls away. */
const LINES = 4;

/** The shares of the stages after the analysis that come before `stage`. */
const sharesBefore = (stage: Stage) =>
  ORDER.slice(1, ORDER.indexOf(stage)).reduce(
    (sum, each) => sum + SHARES[each as keyof typeof SHARES],
    0,
  );

/** Where on the bar the analysis ended, for a page that opens after it: the latest end the bar
 * allows, so the live stage's part starts empty and only ever grows. */
function latestAnalysisEnd(stage: Stage, fraction: number): number {
  const before = sharesBefore(stage);
  return Math.min(ANALYZE_SHARE, Math.max(0, (fraction - before) / (1 - before)));
}

/** How full the live stage's part of the bar is, from where the whole bar is and where the
 * analysis ended on it. */
function stageFill(stage: Stage, fraction: number, analysed: number): number {
  if (stage === "analyze") return Math.min(1, fraction / ANALYZE_SHARE);
  const rest = 1 - analysed;
  const from = analysed + rest * sharesBefore(stage);
  return Math.max(0, Math.min(1, (fraction - from) / (rest * SHARES[stage])));
}

/** The status lines as they come, newest last, a few at a time. */
function useLines(message: string | undefined): string[] {
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    if (!message) return;
    setLines((current) =>
      current.at(-1) === message ? current : [...current, message].slice(-LINES),
    );
  }, [message]);
  return lines;
}

/** The edit as it runs: its four stages as one bar, how far along it is and each thing it does,
 * printed as it does it. A stopped edit's bar stays where it stopped, under the failure's own
 * heading. */
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
  // Where the analysis ended on the bar: where it stood when the plan started, as seen here, or
  // the latest end it allows when the page opened later.
  const analysed = useRef<number | undefined>(undefined);
  const seen = useRef(current);
  if (current && current !== "analyze" && analysed.current === undefined) {
    analysed.current = seen.current === "analyze" ? fraction : latestAnalysisEnd(current, fraction);
  }
  seen.current = current;
  const said = job.progress?.message
    ? [
        short && words.short(short.n, short.of),
        job.progress.file,
        progressText(job.progress.message, t),
      ]
        .filter(Boolean)
        .join(" — ")
    : undefined;
  const lines = useLines(running ? said : undefined);

  return (
    <section
      className="flex flex-col gap-8 px-10 py-9 max-md:px-4 max-md:py-6"
      aria-label={words.progress}
    >
      <div className="flex items-end justify-between gap-6 max-sm:flex-col max-sm:items-start">
        <div className="min-w-0">
          {/* A stopped edit is headed by its failure, in the panel. */}
          {running && <h2 className={TITLE}>{shorts ? words.runningShorts : words.running}</h2>}
          <p className={cn("text-sm text-steel tabular-nums", running && "mt-2")}>
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

      <ol
        className="m-0 grid list-none grid-cols-4 gap-1.5 p-0"
        role="progressbar"
        aria-label={words.progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        {ORDER.map((stage, i) => {
          const times = job.stages[stage];
          const active = stage === current && running;
          const done = Boolean(times?.end) || (current && ORDER.indexOf(current) > i);
          const failed = stage === current && job.status === "error";
          const fill = done
            ? 1
            : stage === current
              ? stageFill(stage, fraction, analysed.current ?? 0)
              : 0;
          return (
            <li key={stage} className="flex min-w-0 flex-col gap-2">
              <span className="relative h-1.5 overflow-hidden rounded-full bg-border">
                <span
                  className={cn(
                    "absolute inset-y-0 left-0 w-full origin-left rounded-full transition-transform duration-700 ease-(--ease-cut)",
                    failed ? "bg-destructive" : "bg-foreground",
                  )}
                  style={{ transform: `scaleX(${fill})` }}
                />
              </span>
              <span className="flex min-w-0 items-baseline justify-between gap-2 max-sm:flex-col max-sm:gap-0">
                <span
                  className={cn(
                    "truncate text-[13px] font-semibold",
                    !active && !done && "text-muted-foreground",
                    failed && "text-destructive",
                  )}
                >
                  {words.stages[stage].name}
                </span>
                <StageTime start={times?.start} end={times?.end} running={active} />
              </span>
            </li>
          );
        })}
      </ol>

      {running && (
        <div className="flex flex-col gap-1" aria-live="polite">
          {/* What the edit is doing, printed as it does it; the latest line is in ink. */}
          {(lines.length ? lines : [words.gettingReady]).map((line, i, all) => (
            <p
              // biome-ignore lint/suspicious/noArrayIndexKey: a line keeps its place from the end.
              key={`${line}-${all.length - i}`}
              className={cn(
                "text-sm [overflow-wrap:anywhere] animate-in fade-in-0 slide-in-from-bottom-1 duration-300",
                i === all.length - 1 ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {i === all.length - 1 && current && (
                <span className="font-semibold">{words.doing(words.stages[current].doing)}</span>
              )}
              {line}
            </p>
          ))}
        </div>
      )}

      {job.download && running && <DownloadView download={job.download} />}

      {(current === "analyze" || current === undefined) && <AnalysisSteps job={job} />}
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
    <span className={META} title={t.run.estimated}>
      {t.run.approximate(formatEstimate((finish - now) / 1000, t))}
    </span>
  );
}

/** The analysis's checklist (lib/steps.ts). */
function AnalysisSteps({ job }: { job: Job }) {
  const words = useT().run;
  const analysing = job.progress?.stage === "analyze";
  const music = job.progress?.step === "music";
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
        {analysisSteps(job).map(({ step, state, count }) => (
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
        ))}
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
