"use client";

import { lookIds } from "@video-editor/engine/looks";
import type { Revision } from "@video-editor/engine/revise";
import {
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { LOCALES } from "../lib/i18n/locale.ts";
import { en, MESSAGES, type Messages } from "../lib/i18n/messages.ts";
import { overlayLabel, progressText } from "../lib/i18n/program.ts";
import type { EditView, Job } from "../lib/jobs.ts";
import { formatClock, formatDollars } from "../lib/settings.ts";
import { dollarsOf } from "../lib/summary.ts";
import { spacedWords } from "../lib/transcript.ts";
import { ErrorNote } from "./ErrorNote.tsx";
import styles from "./editor.module.css";
import { useLocale, useT } from "./I18n.tsx";
import { Replan } from "./Replan.tsx";

/** Ticks in a second, as project.json counts time. */
const TICKS = 120_000;
const LOOKS = [...lookIds, "none"] as const;
const CAPTION_STYLES = ["bold", "spotlight", "sweep", "boxed"] as const;

/** The changes waiting for Apply. Words are by their place in the whole transcript. */
interface Draft {
  cuts: [number, number][];
  words: Record<string, string>;
  titles: Record<number, Record<string, string>>;
  remove: string[];
  music?: { gainDb: number } | "remove";
  look?: string;
  captions?: string;
}
const EMPTY: Draft = { cuts: [], words: {}, titles: {}, remove: [] };

interface Landed {
  removed: [number, number][];
  length: number;
  /** Words a cut takes beyond the selection, by the cut's index, where none of its pauses fit. */
  outside: { range: number; words: string }[];
}

type Word = EditView["lines"][number]["words"][number] & { line: number; word: number };

const seconds = (ticks: number) => (ticks / TICKS).toFixed(2);

/** The finished video's transcript and what can change without planning again, applied in one
 * render as a new version. */
export function ReEdit({
  job,
  onJob,
  video,
}: {
  job: Job;
  /** Called with the job as the server has it after a request changed it. */
  onJob: (job: Job) => void;
  /** The player, which Space plays and the arrow keys step. */
  video: RefObject<HTMLVideoElement | null>;
}) {
  const t = useT();
  const words = t.reedit;
  const [view, setView] = useState<EditView | null>(null);
  const [replanning, setReplanning] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  // The drafts before each change, for Ctrl+Z.
  const [history, setHistory] = useState<Draft[]>([]);
  // The transcript's one word in the tab order; the arrow keys move it.
  const [cursor, setCursor] = useState(0);
  const transcript = useRef<HTMLFieldSetElement>(null);
  const [selection, setSelection] = useState<[number, number] | null>(null);
  const [landed, setLanded] = useState<Landed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = job.current ?? 1;
  const rendering = job.render && !job.render.error ? job.render : null;

  // The version shown, again whenever another is shown; changes were to the one before.
  useEffect(() => {
    let live = true;
    setDraft(EMPTY);
    setHistory([]);
    setCursor(0);
    setSelection(null);
    setLanded(null);
    void fetch(`/api/jobs/${job.id}/edit?v=${current}`)
      .then((response) => response.json() as Promise<EditView & { error?: string }>)
      .then((found) => {
        if (!live) return;
        if (found.error) setError(found.error);
        else setView(found);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [job.id, current]);

  // The shortcuts, on the whole page while the re-edit shows; the handler is this render's. They
  // are heard before the player's own controls, which would seek or play as well.
  const keys = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const listen = (event: KeyboardEvent) => keys.current(event);
    document.addEventListener("keydown", listen, true);
    return () => document.removeEventListener("keydown", listen, true);
  }, []);

  const transcriptWords = useMemo<Word[]>(
    () =>
      view?.lines.flatMap((line, l) =>
        line.words.map((word, w) => ({ ...word, line: l, word: w })),
      ) ?? [],
    [view],
  );
  // Where each line's words start in the whole transcript.
  const offsets = useMemo(() => {
    let at = 0;
    return (view?.lines ?? []).map((line) => {
      const first = at;
      at += line.words.length;
      return first;
    });
  }, [view]);
  const revision = useMemo(() => toRevision(draft, transcriptWords), [draft, transcriptWords]);

  // Where the cuts land once moved into the pauses, asked again as they change.
  const cuts = JSON.stringify(revision.cuts ?? []);
  useEffect(() => {
    const ranges = JSON.parse(cuts) as [number, number][];
    if (ranges.length === 0) {
      setLanded(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      void fetch(`/api/jobs/${job.id}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cuts: ranges }),
      })
        .then((response) => response.json() as Promise<Landed & { error?: string }>)
        .then((found) => {
          if (!live) return;
          if (found.error) setError(found.error);
          else {
            setError(null);
            setLanded(found);
          }
        })
        .catch(() => {});
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [cuts, job.id]);

  if (!view) {
    keys.current = () => {};
    return (
      <section className={`${styles.card} ${styles.reedit}`} aria-label={words.label}>
        {error ? (
          <ErrorNote message={error} fallback={words.loadFallback} />
        ) : (
          <p className={styles.help}>{words.loading}</p>
        )}
      </section>
    );
  }

  const count = changes(draft);
  const blocked = !view.footage
    ? words.noFootage
    : rendering
      ? null
      : count === 0
        ? words.noChange
        : null;
  const [from, to]: [number, number] = selection
    ? [Math.min(...selection), Math.max(...selection)]
    : [-1, -1];
  const inCut = (g: number) => draft.cuts.some(([a, b]) => g >= a && g <= b);
  const gone = (word: Word) =>
    landed?.removed.some(
      ([a, b]) => (word.start + word.end) / 2 >= a && (word.start + word.end) / 2 < b,
    ) ?? false;
  // A cut's landed start or end in the pause before word g.
  const marksBefore = (g: number) => {
    const word = transcriptWords[g] as Word;
    const previous = transcriptWords[g - 1];
    return (landed?.removed ?? []).flatMap(([a, b]) =>
      [a, b].filter(
        (t) => t <= word.start && (!previous || t >= previous.end) && (t !== 0 || g === 0),
      ),
    );
  };
  const marksAfterLast = (landed?.removed ?? []).flatMap(([a, b]) =>
    [a, b].filter((t) => transcriptWords.length > 0 && t >= (transcriptWords.at(-1) as Word).end),
  );

  const apply = async () => {
    setError(null);
    const response = await fetch(`/api/jobs/${job.id}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        revision,
        summary: describe(draft, en),
        summaries: Object.fromEntries(
          LOCALES.map((locale) => [locale, describe(draft, MESSAGES[locale])]),
        ),
      }),
    });
    const body = (await response.json().catch(() => ({}))) as Job & { error?: string };
    if (!response.ok) setError(body.error ?? words.notApplied);
    else onJob(body);
  };
  const stop = () =>
    void fetch(`/api/jobs/${job.id}`, { method: "DELETE" })
      .then((response) => response.json() as Promise<Job>)
      .then(onJob)
      .catch(() => {});

  /** Makes `next` the draft, keeping this one for Ctrl+Z. */
  const change = (next: Draft) => {
    setHistory([...history, draft]);
    setDraft(next);
  };
  const undo = () => {
    const last = history.at(-1);
    if (!last) return false;
    setHistory(history.slice(0, -1));
    setDraft(last);
    return true;
  };

  const deleteSelection = () => {
    if (!selection) return;
    // Overlapping and touching cuts become one.
    const next: [number, number][] = [];
    for (const [a, b] of [...draft.cuts, [from, to] as [number, number]].sort(
      (x, y) => x[0] - y[0],
    )) {
      const last = next.at(-1);
      if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
      else next.push([a, b]);
    }
    change({ ...draft, cuts: next });
    setSelection(null);
  };
  const single = selection && from === to ? (transcriptWords[from] as Word) : null;

  keys.current = (event) => {
    const target = event.target as HTMLElement;
    // Typing in a field keeps every key for the field, its own undo included.
    if (event.defaultPrevented || event.altKey || target.closest("input, textarea, select")) return;
    const player = video.current;
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
      if (undo()) handled();
      return;
    }
    if (event.ctrlKey || event.metaKey) return;
    if (event.key === " " && player) {
      // A button other than a transcript word keeps Space to press it.
      if (target.closest("button, a, summary") && !target.closest("[data-word]")) return;
      handled();
      if (player.paused) void player.play();
      else player.pause();
    } else if ((event.key === "Delete" || event.key === "Backspace") && selection) {
      handled();
      deleteSelection();
    } else if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && target === player) {
      handled();
      player.pause();
      const frame = 1 / view.fps;
      const t = player.currentTime + (event.key === "ArrowLeft" ? -frame : frame);
      player.currentTime = Math.min(Math.max(0, t), player.duration || t);
    }
  };

  /** Moves the transcript's focus to word `g`, extending the selection with Shift. */
  const moveTo = (g: number, extend: boolean) => {
    const next = Math.min(Math.max(0, g), transcriptWords.length - 1);
    setCursor(next);
    if (extend) setSelection([selection?.[0] ?? cursor, next]);
    transcript.current?.querySelector<HTMLElement>(`[data-word="${next}"]`)?.focus();
  };
  const onTranscriptKey = (event: ReactKeyboardEvent) => {
    const word = transcriptWords[cursor];
    const step: Record<string, number | undefined> = {
      ArrowLeft: cursor - 1,
      ArrowRight: cursor + 1,
      Home: 0,
      End: transcriptWords.length - 1,
      // The first word of the line before or after.
      ArrowUp: word ? (offsets[word.line - 1] ?? 0) : 0,
      ArrowDown: word ? (offsets[word.line + 1] ?? transcriptWords.length - 1) : 0,
    };
    const to = step[event.key];
    if (to === undefined) return;
    event.preventDefault();
    moveTo(to, event.shiftKey);
  };
  const key = (word: Word) => `${word.line}:${word.word}`;
  // Where a line's text puts a space between two of its words.
  const spaced = view.lines.map(spacedWords);
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <section className={`${styles.card} ${styles.reedit}`} aria-label={words.label}>
      <div className={styles.reeditHead}>
        <div>
          <h2 className={styles.filesTitle}>{words.title}</h2>
          <p className={styles.filesMeta}>
            {words.version(view.version, formatClock(view.length / TICKS))}
            {landed && words.afterCuts(formatClock(landed.length / TICKS))}
          </p>
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{words.transcript}</h3>
        <p className={styles.help} id={`${job.id}-transcript-help`}>
          {words.help}
        </p>
        <p className={styles.keys}>
          <span>
            <kbd>Space</kbd> {words.keys.play}
          </span>
          <span>
            <kbd>←</kbd>
            <kbd>→</kbd> {words.keys.move} <kbd>Shift</kbd> {words.keys.select}
          </span>
          <span>
            <kbd>Delete</kbd> {words.keys.cut}
          </span>
          <span>
            <kbd>{mac ? "⌘" : "Ctrl"}</kbd>
            <kbd>Z</kbd> {words.keys.undo}
          </span>
          <span>
            <kbd>←</kbd>
            <kbd>→</kbd> {words.keys.frame}
          </span>
        </p>
        {transcriptWords.length === 0 ? (
          <p className={styles.help}>{words.noCaptions}</p>
        ) : (
          <>
            <Timeline
              length={view.length}
              asked={revision.cuts ?? []}
              landed={landed?.removed ?? []}
            />
            <fieldset
              ref={transcript}
              className={styles.transcript}
              aria-label={words.transcript}
              aria-describedby={`${job.id}-transcript-help`}
              onKeyDown={onTranscriptKey}
            >
              {view.lines.map((line, l) => (
                <p key={line.words[0]?.start ?? line.text} className={styles.transcriptLine}>
                  {line.words.map((_, w) => {
                    const g = (offsets[l] ?? 0) + w;
                    const word = transcriptWords[g] as Word;
                    const fixed = draft.words[key(word)];
                    const state =
                      g >= from && g <= to
                        ? "selected"
                        : gone(word)
                          ? "gone"
                          : inCut(g)
                            ? landed
                              ? "kept"
                              : "cut"
                            : fixed !== undefined
                              ? "fixed"
                              : undefined;
                    return (
                      <Fragment key={key(word)}>
                        {spaced[l]?.[w] && " "}
                        {marksBefore(g).map((t) => (
                          <span key={t} className={styles.cutMark} title={words.lands(seconds(t))}>
                            ✂
                          </span>
                        ))}
                        <button
                          type="button"
                          className={styles.word}
                          data-state={state}
                          data-word={g}
                          tabIndex={g === cursor ? 0 : -1}
                          aria-pressed={state === "selected"}
                          onFocus={() => setCursor(g)}
                          title={
                            state === "kept"
                              ? words.keptWord
                              : words.span(seconds(word.start), seconds(word.end))
                          }
                          onClick={(event) =>
                            setSelection(event.shiftKey && selection ? [selection[0], g] : [g, g])
                          }
                        >
                          {fixed ?? word.text}
                          {state && state !== "selected" && (
                            <span className={styles.visuallyHidden}> ({words.states[state]})</span>
                          )}
                        </button>
                      </Fragment>
                    );
                  })}
                </p>
              ))}
              {marksAfterLast.map((t) => (
                <span key={t} className={styles.cutMark} title={words.lands(seconds(t))}>
                  ✂
                </span>
              ))}
            </fieldset>
          </>
        )}
        {selection && (
          <div className={styles.toolbar}>
            <span className={styles.help}>
              {words.selected(
                to - from + 1,
                words.span(
                  seconds((transcriptWords[from] as Word).start),
                  seconds((transcriptWords[to] as Word).end),
                ),
              )}
            </span>
            <button type="button" className={styles.button} onClick={deleteSelection}>
              {words.delete}
            </button>
            {single && (
              <WordFix
                key={key(single)}
                text={draft.words[key(single)] ?? single.text}
                onFix={(text) => {
                  const fixes = { ...draft.words };
                  if (text === single.text) delete fixes[key(single)];
                  else fixes[key(single)] = text;
                  change({ ...draft, words: fixes });
                  setSelection(null);
                }}
              />
            )}
            <button type="button" className={styles.linkButton} onClick={() => setSelection(null)}>
              {words.clear}
            </button>
          </div>
        )}
        {draft.cuts.length > 0 && (
          <ul className={styles.cutList}>
            {draft.cuts.map(([a, b], i) => {
              const asked = revision.cuts?.[i];
              const span = asked && landed?.removed.find(([x, y]) => x < asked[1] && y > asked[0]);
              return (
                <li key={`${a}-${b}`}>
                  {words.cutWords(
                    said(
                      transcriptWords
                        .slice(a, b + 1)
                        .map((word) => draft.words[key(word)] ?? word.text),
                    ),
                  )}
                  {span && words.landsSpan(words.span(seconds(span[0]), seconds(span[1])))}{" "}
                  {landed?.outside
                    .filter((extra) => extra.range === i)
                    .map((extra) => (
                      <span key={extra.words} className={styles.warning}>
                        {words.outside(extra.words)}
                      </span>
                    ))}
                  <button
                    type="button"
                    className={styles.inlineButton}
                    onClick={() => change({ ...draft, cuts: draft.cuts.filter((_, j) => j !== i) })}
                  >
                    {words.undo}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {view.titles.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>{words.titles}</h3>
          {view.titles.map((title) => (
            <div key={title.index} className={styles.titleFields}>
              {Object.entries(title.limits).map(([name, limit]) => (
                <label key={name} className={styles.field}>
                  <span className={styles.label}>
                    {title.template === "title" ? "" : words.lowerThird}
                    {words.params[name] ?? name}
                  </span>
                  <input
                    className={styles.input}
                    maxLength={limit}
                    value={draft.titles[title.index]?.[name] ?? title.params[name] ?? ""}
                    onChange={(event) => {
                      const params = { ...draft.titles[title.index], [name]: event.target.value };
                      if (event.target.value === (title.params[name] ?? "")) delete params[name];
                      const titles = { ...draft.titles, [title.index]: params };
                      if (Object.keys(params).length === 0) delete titles[title.index];
                      change({ ...draft, titles });
                    }}
                  />
                </label>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{words.music}</h3>
        {view.music ? (
          <div className={styles.musicRow}>
            <label className={styles.field}>
              <span className={styles.label}>
                {words.volume}{" "}
                {draft.music !== "remove" &&
                  `${(draft.music?.gainDb ?? 0) > 0 ? "+" : ""}${draft.music?.gainDb ?? 0} dB`}
              </span>
              <input
                type="range"
                min={-12}
                max={6}
                step={1}
                disabled={draft.music === "remove"}
                value={draft.music === "remove" ? 0 : (draft.music?.gainDb ?? 0)}
                onChange={(event) => {
                  const gainDb = Number(event.target.value);
                  const { music: _, ...rest } = draft;
                  change(gainDb === 0 ? rest : { ...draft, music: { gainDb } });
                }}
              />
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={draft.music === "remove"}
                onChange={(event) => {
                  const { music: _, ...rest } = draft;
                  change(event.target.checked ? { ...draft, music: "remove" } : rest);
                }}
              />
              {words.removeMusic}
            </label>
          </div>
        ) : (
          <p className={styles.help}>{words.noMusic}</p>
        )}
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{words.look}</h3>
        <div className={styles.chips}>
          {LOOKS.map((look) => (
            <button
              key={look}
              type="button"
              className={styles.chip}
              aria-pressed={(draft.look ?? view.look) === look}
              onClick={() => {
                const { look: _, ...rest } = draft;
                change(look === view.look ? rest : { ...draft, look });
              }}
            >
              {t.looks[look].name}
            </button>
          ))}
        </div>
      </div>

      {view.captions && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>{words.captionStyle}</h3>
          <div className={styles.captionStyles}>
            {CAPTION_STYLES.map((style) => (
              <button
                key={style}
                type="button"
                className={styles.captionStyle}
                aria-pressed={(draft.captions ?? view.captions) === style}
                onClick={() => {
                  const { captions: _, ...rest } = draft;
                  change(style === view.captions ? rest : { ...draft, captions: style });
                }}
              >
                <span className={styles.captionPreview} data-style={style} aria-hidden="true">
                  <span>{words.preview[0]}</span>
                  <span data-active="true">{words.preview[1]}</span>
                  <span>{words.preview[2]}</span>
                </span>
                {t.captions[style]?.name ?? style}
              </button>
            ))}
          </div>
        </div>
      )}

      {view.removables.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>{words.overlays}</h3>
          <ul className={styles.overlayList}>
            {view.removables.map((item) => {
              const id = `${item.kind}:${item.index}`;
              const removed = draft.remove.includes(id);
              return (
                <li key={id} className={styles.overlayItem} data-removed={removed}>
                  <span className={styles.tabular}>{formatClock(item.start / TICKS)}</span>
                  <span className={styles.overlayLabel}>{overlayLabel(item.label, t)}</span>
                  <button
                    type="button"
                    className={styles.inlineButton}
                    onClick={() =>
                      change({
                        ...draft,
                        remove: removed
                          ? draft.remove.filter((each) => each !== id)
                          : [...draft.remove, id],
                      })
                    }
                  >
                    {removed ? words.keep : words.remove}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{words.replanTitle}</h3>
        <p className={styles.help}>{words.replanHelp}</p>
        {view.older && <p className={styles.help}>{words.older}</p>}
        {replanning ? (
          <Replan job={job} onJob={onJob} onClose={() => setReplanning(false)} />
        ) : (
          <button
            type="button"
            className={styles.button}
            onClick={() => setReplanning(true)}
            disabled={!view.footage || rendering !== null}
          >
            {words.replan}
          </button>
        )}
      </div>

      {error && <ErrorNote message={error} fallback={words.fallback} />}
      {job.render?.error && (
        <ErrorNote message={job.render.error} fallback={words.renderFallback} />
      )}
      {rendering ? (
        <div className={styles.uploading} aria-live="polite">
          <div className={styles.uploadHead}>
            <span>{words.rendering(rendering.version, progressText(rendering.message, t))}</span>
            <span className={styles.tabular}>{Math.floor(rendering.fraction * 100)}%</span>
          </div>
          <div className={styles.bar}>
            <div className={styles.barFill} style={{ width: `${rendering.fraction * 100}%` }} />
          </div>
          <p className={styles.help}>{words.keepsPlaying(current)}</p>
          <button type="button" className={styles.button} onClick={stop}>
            {words.stop}
          </button>
        </div>
      ) : (
        <div className={styles.go}>
          <button
            type="button"
            className={styles.primary}
            disabled={blocked !== null}
            onClick={() => void apply()}
          >
            {count > 0 ? words.applyCount(count) : words.apply}
          </button>
          <p className={styles.help}>
            {blocked ?? words.renders(describe(draft, t), nextVersion(job))}
          </p>
        </div>
      )}
    </section>
  );
}

function WordFix({ text, onFix }: { text: string; onFix: (text: string) => void }) {
  const words = useT().reedit;
  const [value, setValue] = useState(text);
  return (
    <form
      className={styles.wordFix}
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) onFix(value.trim());
      }}
    >
      <input
        className={styles.input}
        aria-label={words.word}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="submit" className={styles.button} disabled={!value.trim()}>
        {words.fix}
      </button>
    </form>
  );
}

/** The edit's length as a bar: the stretches asked for, and where the cuts land. */
function Timeline({
  length,
  asked,
  landed,
}: {
  length: number;
  asked: readonly [number, number][];
  landed: readonly [number, number][];
}) {
  const at = (t: number) => `${(t / Math.max(1, length)) * 100}%`;
  return (
    <div className={styles.timeline} aria-hidden="true">
      {asked.map(([a, b]) => (
        <span
          key={`a${a}`}
          className={styles.timelineAsked}
          style={{ left: at(a), width: at(b - a) }}
        />
      ))}
      {landed.map(([a, b]) => (
        <span
          key={`l${a}`}
          className={styles.timelineLanded}
          style={{ left: at(a), width: at(b - a) }}
        />
      ))}
    </div>
  );
}

/** The versions of a finished edit, newest first, to show again. */
export function Versions({ job, onJob }: { job: Job; onJob: (job: Job) => void }) {
  const t = useT();
  const { locale } = useLocale();
  const words = t.versions;
  const versions = job.versions ?? [];
  const [error, setError] = useState<string | null>(null);
  if (versions.length < 2) return null;
  const current = job.current ?? 1;
  const busy = job.render !== undefined && !job.render.error;
  const show = async (n: number) => {
    const response = await fetch(`/api/jobs/${job.id}/versions/${n}`, { method: "POST" });
    const body = (await response.json().catch(() => ({}))) as Job & { error?: string };
    if (!response.ok) setError(body.error ?? words.notShown);
    else {
      setError(null);
      onJob(body);
    }
  };
  return (
    <div className={styles.versions}>
      <h3 className={styles.sectionTitle}>{words.title}</h3>
      <ul className={styles.versionList}>
        {[...versions].reverse().map((version) => (
          <li key={version.n} className={styles.versionItem} data-current={version.n === current}>
            <span className={styles.fileText}>
              <span className={styles.fileName}>
                {words.version(version.n)}
                {version.n === current && words.shown}
              </span>
              <span className={styles.fileMeta}>
                {t.date(version.created)}
                {version.seconds !== undefined && ` · ${formatClock(version.seconds)}`}
                {version.claude && ` · Claude ${formatDollars(dollarsOf(version.claude), t)}`}
                {" · "}
                {/* The first is the edit itself, whichever language its record was made in; a
                    later one from before the summaries in each language has only the English. */}
                {version.n === 1
                  ? words.first(Boolean(job.settings.instructions))
                  : (version.summaries?.[locale] ?? version.summary)}
                {busy && job.render?.version === version.n
                  ? words.rendering
                  : !version.video && words.notKept}
              </span>
            </span>
            {version.n !== current && !(busy && job.render?.version === version.n) && (
              <button
                type="button"
                className={styles.button}
                disabled={busy}
                onClick={() => void show(version.n)}
              >
                {version.video ? words.show : words.again}
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className={styles.help}>{words.kept}</p>
      {error && <ErrorNote message={error} fallback={words.fallback} />}
    </div>
  );
}

/** Words as a line says them: a space only between two that are not Chinese. */
function said(texts: readonly string[]): string {
  return texts.reduce(
    (line, text) => (/[\w]$/.test(line) && /^[\w]/.test(text) ? `${line} ${text}` : line + text),
    "",
  );
}

function nextVersion(job: Job): number {
  return Math.max(1, ...(job.versions ?? []).map((version) => version.n)) + 1;
}

function toRevision(draft: Draft, words: readonly Word[]): Revision {
  const revision: Revision = {};
  const cuts = draft.cuts.flatMap(([a, b]): [number, number][] => {
    const first = words[a];
    const last = words[b];
    return first && last ? [[first.start, last.end]] : [];
  });
  if (cuts.length > 0) revision.cuts = cuts;
  const fixes = Object.entries(draft.words).map(([at, text]) => {
    const [line, word] = at.split(":").map(Number) as [number, number];
    return { line, word, text };
  });
  if (fixes.length > 0) revision.words = fixes;
  const titles = Object.entries(draft.titles).map(([index, params]) => ({
    index: Number(index),
    params,
  }));
  if (titles.length > 0) revision.overlays = titles;
  if (draft.remove.length > 0) {
    revision.remove = draft.remove.map((id) => {
      const [kind, index] = id.split(":") as ["overlay" | "graphic" | "broll", string];
      return { kind, index: Number(index) };
    });
  }
  if (draft.music) revision.music = draft.music;
  if (draft.look) revision.look = draft.look as Revision["look"];
  if (draft.captions) revision.captions = draft.captions as Revision["captions"];
  return revision;
}

function changes(draft: Draft): number {
  return (
    draft.cuts.length +
    Object.keys(draft.words).length +
    Object.keys(draft.titles).length +
    draft.remove.length +
    (draft.music ? 1 : 0) +
    (draft.look ? 1 : 0) +
    (draft.captions ? 1 : 0)
  );
}

/** The changes in a few of `t`'s words, for the version list. */
function describe(draft: Draft, t: Messages): string {
  const words = t.reedit.describe;
  const parts = [
    draft.cuts.length > 0 && words.cuts(draft.cuts.length),
    Object.keys(draft.words).length > 0 && words.words(Object.keys(draft.words).length),
    Object.keys(draft.titles).length > 0 && words.titles,
    draft.remove.length > 0 && words.removed(draft.remove.length),
    draft.music === "remove"
      ? words.noMusic
      : draft.music && words.music(`${draft.music.gainDb > 0 ? "+" : ""}${draft.music.gainDb}`),
    draft.look &&
      words.look(draft.look, t.looks[draft.look as keyof Messages["looks"]]?.name ?? draft.look),
    draft.captions &&
      words.captions(draft.captions, t.captions[draft.captions]?.name ?? draft.captions),
  ].filter((part): part is string => Boolean(part));
  const text = parts.join(t.list);
  return text ? text[0]?.toUpperCase() + text.slice(1) : words.none;
}
