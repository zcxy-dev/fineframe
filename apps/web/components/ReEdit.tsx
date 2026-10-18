"use client";

import { lookIds } from "@video-editor/engine/looks";
import type { Revision } from "@video-editor/engine/revise";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { EditView, Job } from "../lib/jobs.ts";
import { formatClock, formatDollars } from "../lib/settings.ts";
import { dollarsOf } from "../lib/summary.ts";
import styles from "./editor.module.css";
import { AlertIcon } from "./icons.tsx";
import { Replan } from "./Replan.tsx";

/** Ticks in a second, as project.json counts time. */
const TICKS = 120_000;
const LOOKS = [...lookIds, "none"] as const;
const CAPTION_STYLES = [
  { id: "bold", name: "Bold" },
  { id: "spotlight", name: "Spotlight" },
  { id: "sweep", name: "Sweep" },
  { id: "boxed", name: "Boxed" },
] as const;
const PARAM_NAMES: Record<string, string> = {
  text: "Title",
  subtitle: "Subtitle",
  name: "Name",
  role: "Role",
};

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
}: {
  job: Job;
  /** Called with the job as the server has it after a request changed it. */
  onJob: (job: Job) => void;
}) {
  const [view, setView] = useState<EditView | null>(null);
  const [replanning, setReplanning] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [selection, setSelection] = useState<[number, number] | null>(null);
  const [landed, setLanded] = useState<Landed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = job.current ?? 1;
  const rendering = job.render && !job.render.error ? job.render : null;

  // The version shown, again whenever another is shown; changes were to the one before.
  useEffect(() => {
    let live = true;
    setDraft(EMPTY);
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

  const words = useMemo<Word[]>(
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
  const revision = useMemo(() => toRevision(draft, words), [draft, words]);

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
    return (
      <section className={`${styles.card} ${styles.reedit}`} aria-label="Change the edit">
        {error ? <p className={styles.error}>{error}</p> : <p className={styles.help}>Loading…</p>}
      </section>
    );
  }

  const count = changes(draft);
  const blocked = !view.footage
    ? "This project's footage was deleted, so it cannot change; make a new edit from the footage"
    : rendering
      ? null
      : count === 0
        ? "Make a change first"
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
    const word = words[g] as Word;
    const previous = words[g - 1];
    return (landed?.removed ?? []).flatMap(([a, b]) =>
      [a, b].filter(
        (t) => t <= word.start && (!previous || t >= previous.end) && (t !== 0 || g === 0),
      ),
    );
  };
  const marksAfterLast = (landed?.removed ?? []).flatMap(([a, b]) =>
    [a, b].filter((t) => words.length > 0 && t >= (words.at(-1) as Word).end),
  );

  const apply = async () => {
    setError(null);
    const response = await fetch(`/api/jobs/${job.id}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision, summary: describe(draft) }),
    });
    const body = (await response.json().catch(() => ({}))) as Job & { error?: string };
    if (!response.ok) setError(body.error ?? "The changes could not be applied");
    else onJob(body);
  };
  const stop = () =>
    void fetch(`/api/jobs/${job.id}`, { method: "DELETE" })
      .then((response) => response.json() as Promise<Job>)
      .then(onJob)
      .catch(() => {});

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
    setDraft({ ...draft, cuts: next });
    setSelection(null);
  };
  const single = selection && from === to ? (words[from] as Word) : null;
  const key = (word: Word) => `${word.line}:${word.word}`;

  return (
    <section className={`${styles.card} ${styles.reedit}`} aria-label="Change the edit">
      <div className={styles.reeditHead}>
        <div>
          <h2 className={styles.filesTitle}>Change the edit</h2>
          <p className={styles.filesMeta}>
            Version {view.version} · {formatClock(view.length / TICKS)}
            {landed && ` · ${formatClock(landed.length / TICKS)} after the cuts`}
          </p>
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Transcript</h3>
        <p className={styles.help}>
          Click a word, then Shift-click another to select the words between. Delete them, or fix a
          single caption word. Each cut moves to a pause inside your selection, so no word is cut
          through; ✂ marks where it lands, and selected words a dotted line marks stay.
        </p>
        {words.length === 0 ? (
          <p className={styles.help}>This edit has no captions to show.</p>
        ) : (
          <>
            <Timeline
              length={view.length}
              asked={revision.cuts ?? []}
              landed={landed?.removed ?? []}
            />
            <div className={styles.transcript}>
              {view.lines.map((line, l) => (
                <p key={line.words[0]?.start ?? line.text} className={styles.transcriptLine}>
                  {line.words.map((_, w) => {
                    const g = (offsets[l] ?? 0) + w;
                    const word = words[g] as Word;
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
                        {marksBefore(g).map((t) => (
                          <span
                            key={t}
                            className={styles.cutMark}
                            title={`Cut lands at ${seconds(t)} s`}
                          >
                            ✂
                          </span>
                        ))}
                        <button
                          type="button"
                          className={styles.word}
                          data-state={state}
                          title={
                            state === "kept"
                              ? "Kept: no pause to cut at beside it inside the selection"
                              : `${seconds(word.start)}–${seconds(word.end)} s`
                          }
                          onClick={(event) =>
                            setSelection(event.shiftKey && selection ? [selection[0], g] : [g, g])
                          }
                        >
                          {fixed ?? word.text}
                        </button>
                      </Fragment>
                    );
                  })}
                </p>
              ))}
              {marksAfterLast.map((t) => (
                <span key={t} className={styles.cutMark} title={`Cut lands at ${seconds(t)} s`}>
                  ✂
                </span>
              ))}
            </div>
          </>
        )}
        {selection && (
          <div className={styles.toolbar}>
            <span className={styles.help}>
              {to - from + 1} {to - from === 0 ? "word" : "words"} selected,{" "}
              {seconds((words[from] as Word).start)}–{seconds((words[to] as Word).end)} s
            </span>
            <button type="button" className={styles.button} onClick={deleteSelection}>
              Delete
            </button>
            {single && (
              <WordFix
                key={key(single)}
                text={draft.words[key(single)] ?? single.text}
                onFix={(text) => {
                  const words = { ...draft.words };
                  if (text === single.text) delete words[key(single)];
                  else words[key(single)] = text;
                  setDraft({ ...draft, words });
                  setSelection(null);
                }}
              />
            )}
            <button type="button" className={styles.linkButton} onClick={() => setSelection(null)}>
              Clear
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
                  Cut “
                  {said(words.slice(a, b + 1).map((word) => draft.words[key(word)] ?? word.text))}”
                  {span && ` · lands ${seconds(span[0])}–${seconds(span[1])} s`}{" "}
                  {landed?.outside
                    .filter((extra) => extra.range === i)
                    .map((extra) => (
                      <span key={extra.words} className={styles.warning}>
                        No pause inside your selection, so this cut also removes: {extra.words}
                      </span>
                    ))}
                  <button
                    type="button"
                    className={styles.inlineButton}
                    onClick={() =>
                      setDraft({ ...draft, cuts: draft.cuts.filter((_, j) => j !== i) })
                    }
                  >
                    Undo
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {view.titles.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Title and lower thirds</h3>
          {view.titles.map((title) => (
            <div key={title.index} className={styles.titleFields}>
              {Object.entries(title.limits).map(([name, limit]) => (
                <label key={name} className={styles.field}>
                  <span className={styles.label}>
                    {title.template === "title" ? "" : "Lower third · "}
                    {PARAM_NAMES[name] ?? name}
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
                      setDraft({ ...draft, titles });
                    }}
                  />
                </label>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Music</h3>
        {view.music ? (
          <div className={styles.musicRow}>
            <label className={styles.field}>
              <span className={styles.label}>
                Volume{" "}
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
                  setDraft(gainDb === 0 ? rest : { ...draft, music: { gainDb } });
                }}
              />
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={draft.music === "remove"}
                onChange={(event) => {
                  const { music: _, ...rest } = draft;
                  setDraft(event.target.checked ? { ...draft, music: "remove" } : rest);
                }}
              />
              Remove the music
            </label>
          </div>
        ) : (
          <p className={styles.help}>This edit has no music.</p>
        )}
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Look</h3>
        <div className={styles.chips}>
          {LOOKS.map((look) => (
            <button
              key={look}
              type="button"
              className={styles.chip}
              aria-pressed={(draft.look ?? view.look) === look}
              onClick={() => {
                const { look: _, ...rest } = draft;
                setDraft(look === view.look ? rest : { ...draft, look });
              }}
            >
              {look[0]?.toUpperCase()}
              {look.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {view.captions && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Caption style</h3>
          <div className={styles.captionStyles}>
            {CAPTION_STYLES.map((style) => (
              <button
                key={style.id}
                type="button"
                className={styles.captionStyle}
                aria-pressed={(draft.captions ?? view.captions) === style.id}
                onClick={() => {
                  const { captions: _, ...rest } = draft;
                  setDraft(style.id === view.captions ? rest : { ...draft, captions: style.id });
                }}
              >
                <span className={styles.captionPreview} data-style={style.id} aria-hidden="true">
                  <span>Say </span>
                  <span data-active="true">it</span>
                  <span> clearly</span>
                </span>
                {style.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {view.removables.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Overlays</h3>
          <ul className={styles.overlayList}>
            {view.removables.map((item) => {
              const id = `${item.kind}:${item.index}`;
              const removed = draft.remove.includes(id);
              return (
                <li key={id} className={styles.overlayItem} data-removed={removed}>
                  <span className={styles.tabular}>{formatClock(item.start / TICKS)}</span>
                  <span className={styles.overlayLabel}>{item.label}</span>
                  <button
                    type="button"
                    className={styles.inlineButton}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        remove: removed
                          ? draft.remove.filter((each) => each !== id)
                          : [...draft.remove, id],
                      })
                    }
                  >
                    {removed ? "Keep" : "Remove"}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Needs a re-plan</h3>
        <p className={styles.help}>
          Reordering, putting removed parts back, a length more than 5 % off, another aspect or
          another music track cannot be changed here: Claude plans the edit again from the same
          footage, whose analysis is kept, so it takes a minute or two and one more plan.
        </p>
        {replanning ? (
          <Replan job={job} onJob={onJob} onClose={() => setReplanning(false)} />
        ) : (
          <button
            type="button"
            className={styles.button}
            onClick={() => setReplanning(true)}
            disabled={!view.footage || rendering !== null}
          >
            Re-plan…
          </button>
        )}
      </div>

      {error && (
        <p className={styles.error} role="alert">
          <AlertIcon width={16} height={16} />
          {error}
        </p>
      )}
      {job.render?.error && (
        <p className={styles.error} role="alert">
          <AlertIcon width={16} height={16} />
          {job.render.error}
        </p>
      )}
      {rendering ? (
        <div className={styles.uploading} aria-live="polite">
          <div className={styles.uploadHead}>
            <span>
              Rendering version {rendering.version} · {rendering.message}
            </span>
            <span className={styles.tabular}>{Math.floor(rendering.fraction * 100)}%</span>
          </div>
          <div className={styles.bar}>
            <div className={styles.barFill} style={{ width: `${rendering.fraction * 100}%` }} />
          </div>
          <p className={styles.help}>Version {current} keeps playing until the new one is ready.</p>
          <button type="button" className={styles.button} onClick={stop}>
            Stop
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
            {count > 0 ? `Apply ${count} ${count === 1 ? "change" : "changes"}` : "Apply"}
          </button>
          <p className={styles.help}>
            {blocked ?? `${describe(draft)}. Renders once as version ${nextVersion(job)}.`}
          </p>
        </div>
      )}
    </section>
  );
}

function WordFix({ text, onFix }: { text: string; onFix: (text: string) => void }) {
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
        aria-label="Caption word"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="submit" className={styles.button} disabled={!value.trim()}>
        Fix word
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
  const versions = job.versions ?? [];
  const [error, setError] = useState<string | null>(null);
  if (versions.length < 2) return null;
  const current = job.current ?? 1;
  const busy = job.render !== undefined && !job.render.error;
  const show = async (n: number) => {
    const response = await fetch(`/api/jobs/${job.id}/versions/${n}`, { method: "POST" });
    const body = (await response.json().catch(() => ({}))) as Job & { error?: string };
    if (!response.ok) setError(body.error ?? "That version could not be shown");
    else {
      setError(null);
      onJob(body);
    }
  };
  return (
    <div className={styles.versions}>
      <h3 className={styles.sectionTitle}>Versions</h3>
      <ul className={styles.versionList}>
        {[...versions].reverse().map((version) => (
          <li key={version.n} className={styles.versionItem} data-current={version.n === current}>
            <span className={styles.fileText}>
              <span className={styles.fileName}>
                Version {version.n}
                {version.n === current && " · shown"}
              </span>
              <span className={styles.fileMeta}>
                {new Date(version.created).toLocaleString()}
                {version.seconds !== undefined && ` · ${formatClock(version.seconds)}`}
                {version.claude && ` · Claude ${formatDollars(dollarsOf(version.claude))}`}
                {" · "}
                {version.summary}
                {busy && job.render?.version === version.n
                  ? " · rendering"
                  : !version.video && " · video not kept"}
              </span>
            </span>
            {version.n !== current && !(busy && job.render?.version === version.n) && (
              <button
                type="button"
                className={styles.button}
                disabled={busy}
                onClick={() => void show(version.n)}
              >
                {version.video ? "Show" : "Render again"}
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className={styles.help}>
        The newest 3 versions keep their video; an older one renders again from its record.
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
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
      const [kind, index] = id.split(":") as ["overlay" | "card" | "broll", string];
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

/** The changes in a few words, for the version list. */
function describe(draft: Draft): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts = [
    draft.cuts.length > 0 && `Cut ${plural(draft.cuts.length, "span", "spans")}`,
    Object.keys(draft.words).length > 0 &&
      `fixed ${plural(Object.keys(draft.words).length, "caption word", "caption words")}`,
    Object.keys(draft.titles).length > 0 && "changed the titles",
    draft.remove.length > 0 && `removed ${plural(draft.remove.length, "overlay", "overlays")}`,
    draft.music === "remove"
      ? "removed the music"
      : draft.music && `music ${draft.music.gainDb > 0 ? "+" : ""}${draft.music.gainDb} dB`,
    draft.look && `look ${draft.look}`,
    draft.captions && `captions ${draft.captions}`,
  ].filter((part): part is string => Boolean(part));
  const text = parts.join(", ");
  return text ? text[0]?.toUpperCase() + text.slice(1) : "No changes";
}
