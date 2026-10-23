"use client";

import { Check, Copy, Download } from "lucide-react";
import { useEffect, useState } from "react";
import type { Job, ShortEdit } from "../lib/jobs.ts";
import { formatClock, formatRange } from "../lib/settings.ts";
import { fewerShorts, jobApi, shortView } from "../lib/shorts.ts";
import { cn, HELP, LABEL, META, PANEL_TITLE, SLUG, WARNING } from "../lib/styles.ts";
import { useT } from "./I18n.tsx";
import { Button } from "./ui/button.tsx";

/** The range each short's length lies in, in `t`'s words. */
function useRange(job: Job): string {
  const t = useT();
  const { min, max } = job.settings.shorts ?? { min: 0, max: job.settings.length };
  return formatRange(min, max, t);
}

/** A short's length now: its version shown's, or as it was made. */
function secondsOf(short: ShortEdit): number | undefined {
  return short.versions?.find((version) => version.n === (short.current ?? 1))?.seconds;
}

const SCREEN: Record<string, string> = {
  "9:16": "aspect-[9/16]",
  "1:1": "aspect-square",
  "16:9": "aspect-video",
};

/**
 * The shorts in Claude's order, best first, each as soon as it is made: a player, its length, its
 * stretch of the footage and its download; while the run goes on, a place for each still being
 * made. A finished one opens as an edit of its own.
 */
export function ShortsGrid({ job, onOpen }: { job: Job; onOpen: (folder: string) => void }) {
  const t = useT();
  const words = t.shorts;
  const range = useRange(job);
  const shorts = job.shorts ?? [];
  const running = job.status === "running";
  const of = job.progress?.short?.of ?? job.settings.shorts?.count ?? shorts.length;
  const waiting = running ? Math.max(0, of - shorts.length) : 0;
  const files = new Set(shorts.map((short) => short.source));
  const screen = SCREEN[job.settings.aspect];
  return (
    <section
      className="flex flex-col gap-4 border-t px-10 py-8 max-md:px-4"
      aria-label={words.label}
    >
      <div>
        <h2 className={SLUG}>{words.title(shorts.length)}</h2>
        <p className={cn(META, "mt-1")}>
          {running ? words.making(shorts.length, of) : range} · {job.settings.aspect}
        </p>
      </div>
      <ol className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-5 gap-y-6 p-0">
        {shorts.map((short, i) => {
          const view = shortView(job, short.folder) as Job;
          const seconds = secondsOf(short) ?? short.seconds;
          return (
            <li
              key={short.folder}
              className="flex min-w-0 flex-col gap-2.5 animate-in fade-in-0 zoom-in-[0.97] duration-500"
            >
              <div
                className={cn(
                  "corners grid place-items-center overflow-hidden rounded-xl border bg-black [--corner:10px]",
                  screen,
                )}
              >
                {/* biome-ignore lint/a11y/useMediaCaption: the captions are burned into the picture. */}
                <video
                  className="block size-full bg-black"
                  // A moment in, so the card shows a frame rather than the first black one.
                  src={`${jobApi(view, "video", { v: view.current ?? 1 })}#t=1`}
                  controls
                  playsInline
                  preload="metadata"
                />
              </div>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[13px] leading-snug font-semibold">
                  {i + 1}. {short.title}
                </span>
                <span className={META}>
                  {formatClock(seconds)} ·{" "}
                  {words.stretch(formatClock(short.start), formatClock(short.end))}
                  {files.size > 1 && ` · ${short.source.split("/").at(-1)}`}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  // Each made short plays and downloads at once; it opens once the run ends.
                  disabled={running}
                  aria-label={words.card(i + 1, short.title)}
                  onClick={() => onOpen(short.folder)}
                >
                  {words.open}
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a href={jobApi(view, "video", { download: "" })} download>
                    <Download aria-hidden="true" />
                    {words.download}
                  </a>
                </Button>
              </div>
            </li>
          );
        })}
        {Array.from({ length: waiting }, (_, i) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: places for shorts not made yet.
            key={i}
            className="flex min-w-0 flex-col gap-2.5"
            aria-busy="true"
          >
            <div className={cn("hatch rounded-xl border border-dashed border-edge", screen)} />
            <div className="flex flex-col gap-0.5">
              <span className="text-[13px] font-semibold text-muted-foreground">
                {shorts.length + i + 1}.
              </span>
              <span className={META}>{words.waiting}</span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The run of shorts once finished: how many were made and why fewer, and "Download all". */
export function ShortsDone({ job }: { job: Job }) {
  const t = useT();
  const words = t.shorts;
  const range = useRange(job);
  const fewer = fewerShorts(job);
  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      <div>
        <h2 className={PANEL_TITLE}>{words.title(job.shorts?.length ?? 0)}</h2>
        <p className="mt-1 text-[13px] text-steel tabular-nums">
          {range} · {job.settings.aspect}
        </p>
      </div>
      {fewer && (
        <p className={WARNING}>
          {fewer.cost
            ? words.stoppedCost(fewer.made, fewer.asked)
            : words.fewer(fewer.made, fewer.asked, range)}
        </p>
      )}
      <Button asChild>
        <a href={jobApi(job, "shorts")} download>
          <Download aria-hidden="true" />
          {words.downloadAll}
        </a>
      </Button>
      <p className={HELP}>{words.allHelp}</p>
    </div>
  );
}

/** The shorts a run made before it was cancelled or stopped: all of them to download, and why
 * they cannot change. */
export function ShortsKept({ job }: { job: Job }) {
  const t = useT();
  const words = t.shorts;
  return (
    <div className="flex flex-col gap-3 border-t px-6 py-5">
      <p className={HELP}>{words.unchangeable(job.status === "cancelled")}</p>
      <Button asChild variant="outline">
        <a href={jobApi(job, "shorts")} download>
          <Download aria-hidden="true" />
          {words.downloadAll}
        </a>
      </Button>
    </div>
  );
}

/** A short's title, description and hashtags, each with a copy button. */
export function ShortText({ short }: { short: ShortEdit }) {
  const t = useT();
  const words = t.shorts;
  const fields = [
    { name: words.titleLabel, text: short.title },
    { name: words.description, text: short.description },
    { name: words.hashtags, text: short.hashtags.join(" ") },
  ];
  return (
    <dl className="m-0 flex flex-col gap-3">
      {fields.map((field) => (
        <div
          key={field.name}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1"
        >
          <dt className={cn(LABEL, "col-span-full")}>{field.name}</dt>
          <dd className="m-0 text-[13px] leading-relaxed [overflow-wrap:anywhere]">{field.text}</dd>
          <dd className="m-0">
            <CopyButton text={field.text} label={`${words.copy}: ${field.name}`} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={label}
      onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}
    >
      {copied ? <Check className="text-success" aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {copied ? t.shorts.copied : t.shorts.copy}
    </Button>
  );
}
