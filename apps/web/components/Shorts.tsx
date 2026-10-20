"use client";

import { useEffect, useState } from "react";
import type { Job, ShortEdit } from "../lib/jobs.ts";
import { formatClock, formatLength } from "../lib/settings.ts";
import { fewerShorts, jobApi, shortView } from "../lib/shorts.ts";
import styles from "./editor.module.css";
import { useT } from "./I18n.tsx";
import { DownloadIcon } from "./icons.tsx";

/** The range each short's length lies in, in `t`'s words. */
function useRange(job: Job): string {
  const t = useT();
  const { min, max } = job.settings.shorts ?? { min: 0, max: job.settings.length };
  return t.settings.range(formatLength(min, t), formatLength(max, t));
}

/** A short's length now: its version shown's, or as it was made. */
function secondsOf(short: ShortEdit): number | undefined {
  return short.versions?.find((version) => version.n === (short.current ?? 1))?.seconds;
}

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
  return (
    <section className={`${styles.card} ${styles.shorts}`} aria-label={words.label}>
      <div className={styles.filesHead}>
        <div>
          <h2 className={styles.filesTitle}>{words.title(shorts.length)}</h2>
          <p className={styles.filesMeta}>
            {running ? words.making(shorts.length, of) : range} · {job.settings.aspect}
          </p>
        </div>
      </div>
      <ol className={styles.shortGrid}>
        {shorts.map((short, i) => {
          const view = shortView(job, short.folder) as Job;
          const seconds = secondsOf(short) ?? short.seconds;
          return (
            <li key={short.folder} className={styles.shortCard}>
              <div className={styles.shortScreen} data-aspect={job.settings.aspect}>
                {/* biome-ignore lint/a11y/useMediaCaption: the captions are burned into the picture. */}
                <video
                  className={styles.video}
                  // A moment in, so the card shows a frame rather than the first black one.
                  src={`${jobApi(view, "video", { v: view.current ?? 1 })}#t=1`}
                  controls
                  playsInline
                  preload="metadata"
                />
              </div>
              <div className={styles.shortText}>
                <span className={styles.shortTitle}>
                  {i + 1}. {short.title}
                </span>
                <span className={styles.fileMeta}>
                  {formatClock(seconds)} ·{" "}
                  {words.stretch(formatClock(short.start), formatClock(short.end))}
                  {files.size > 1 && ` · ${short.source.split("/").at(-1)}`}
                </span>
              </div>
              <div className={styles.shortActions}>
                <button
                  type="button"
                  className={styles.button}
                  disabled={running}
                  aria-label={words.card(i + 1, short.title)}
                  onClick={() => onOpen(short.folder)}
                >
                  {words.open}
                </button>
                <a
                  className={styles.button}
                  href={jobApi(view, "video", { download: "" })}
                  download
                >
                  <DownloadIcon width={16} height={16} />
                  {words.download}
                </a>
              </div>
            </li>
          );
        })}
        {Array.from({ length: waiting }, (_, i) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: places for shorts not made yet.
            key={i}
            className={`${styles.shortCard} ${styles.shortWaiting}`}
            aria-busy="true"
          >
            <div className={styles.shortScreen} data-aspect={job.settings.aspect} />
            <div className={styles.shortText}>
              <span className={styles.shortTitle}>{shorts.length + i + 1}.</span>
              <span className={styles.fileMeta}>{words.waiting}</span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The run of shorts once finished: how many were made and why fewer, and "Download all". */
export function ShortsDone({ job, onNew }: { job: Job; onNew: () => void }) {
  const t = useT();
  const words = t.shorts;
  const range = useRange(job);
  const fewer = fewerShorts(job);
  return (
    <div className={styles.block}>
      <div>
        <h2 className={styles.panelTitle}>{words.title(job.shorts?.length ?? 0)}</h2>
        <p className={styles.resultMeta}>
          {range} · {job.settings.aspect}
        </p>
      </div>
      {fewer && <p className={styles.warning}>{words.fewer(fewer.made, fewer.asked, range)}</p>}
      <div className={styles.downloads}>
        <a className={styles.primary} href={jobApi(job, "shorts")} download>
          <DownloadIcon width={18} height={18} />
          {words.downloadAll}
        </a>
        <p className={styles.help}>{words.allHelp}</p>
      </div>
      <button type="button" className={styles.linkButton} onClick={onNew}>
        {t.done.another}
      </button>
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
    <dl className={styles.shortFields}>
      {fields.map((field) => (
        <div key={field.name} className={styles.shortField}>
          <dt className={styles.label}>{field.name}</dt>
          <dd className={styles.shortValue}>{field.text}</dd>
          <dd>
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
    <button
      type="button"
      className={styles.button}
      aria-label={label}
      onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}
    >
      {copied ? t.shorts.copied : t.shorts.copy}
    </button>
  );
}
