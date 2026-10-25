"use client";

import { CAPTION_STYLES, type CaptionStyle } from "@video-editor/engine/captions";
import { lookIds } from "@video-editor/engine/looks";
import { Scissors, Undo2 } from "lucide-react";
import {
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
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
import { jobApi } from "../lib/shorts.ts";
import {
  CHECK,
  CHOICE,
  cn,
  HELP,
  LABEL,
  LIST,
  META,
  SECTION,
  SLUG,
  WARNING,
} from "../lib/styles.ts";
import { dollarsOf } from "../lib/summary.ts";
import { spacedWords } from "../lib/transcript.ts";
import type { PageRevision } from "../lib/versions.ts";
import { KitCaptionPreview, useKits } from "./BrandKits.tsx";
import { CaptionPreview } from "./CaptionPreview.tsx";
import { ErrorNote } from "./ErrorNote.tsx";
import { useLocale, useT } from "./I18n.tsx";
import { MusicPicker } from "./MusicPicker.tsx";
import { Replan } from "./Replan.tsx";
import { Player } from "./ResultView.tsx";
import { Bar } from "./RunView.tsx";
import { Segments } from "./Segments.tsx";
import { Button } from "./ui/button.tsx";
import { Input, NativeSelect } from "./ui/input.tsx";
import { NumberTicker } from "./ui/number-ticker.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs.tsx";

/** Ticks in a second, as project.json counts time. */
const TICKS = 120_000;
const LOOKS = [...lookIds, "none"] as const;

/** The changes waiting for Apply. Words are by their place in the whole transcript. */
interface Draft {
  cuts: [number, number][];
  words: Record<string, string>;
  titles: Record<number, Record<string, string>>;
  remove: string[];
  /** Another level, no music, or a library track swapped in, by its id and title. */
  music?: { gainDb: number } | "remove" | { track: string; title: string };
  look?: string;
  captions?: CaptionStyle;
  /** The captions' emoji shown or hidden, when not as the version has them. */
  emoji?: boolean;
  /** Another brand kit, by its id and name, or null for none. */
  kit?: { id: string; name: string } | null;
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

/**
 * The editing room for a finished edit: the player in the middle, the transcript as a timeline
 * under it, and a panel on the right whose tabs hold the result's files and what can change
 * without planning again, with Apply at its foot, which renders the changes once as a new
 * version. A short of a stopped run (`editable` false) only plays and downloads.
 */
export function ReEdit({
  job,
  onJob,
  video,
  head,
  result,
  download,
  editable,
}: {
  job: Job;
  /** Called with the job as the server has it after a request changed it. */
  onJob: (job: Job) => void;
  /** The player, which Space plays and the arrow keys step. */
  video: RefObject<HTMLVideoElement | null>;
  /** The panel's heading over its tabs: what the edit is. */
  head: ReactNode;
  /** The download, right under the player where the panes stack, as on a phone. */
  download: ReactNode;
  /** The Result tab: the downloads, the versions and the edit's details. */
  result: ReactNode;
  editable: boolean;
}) {
  const t = useT();
  const words = t.reedit;
  const [view, setView] = useState<EditView | null>(null);
  const [tab, setTab] = useState("result");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  // The drafts before each change, for Ctrl+Z.
  const [history, setHistory] = useState<Draft[]>([]);
  // The transcript's one word in the tab order; the arrow keys move it.
  const [cursor, setCursor] = useState(0);
  const transcript = useRef<HTMLFieldSetElement>(null);
  const [selection, setSelection] = useState<[number, number] | null>(null);
  const [landed, setLanded] = useState<Landed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { list: kits } = useKits();
  const current = job.current ?? 1;
  const rendering = job.render && !job.render.error ? job.render : null;
  const playing = usePlayback(video);

  // The version shown, again whenever another is shown; changes were to the one before.
  const shownUrl = editable ? jobApi(job, "edit", { v: current }) : null;
  useEffect(() => {
    let live = true;
    setDraft(EMPTY);
    setHistory([]);
    setCursor(0);
    setSelection(null);
    setLanded(null);
    if (!shownUrl) return;
    void fetch(shownUrl)
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
  }, [shownUrl]);

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
  const previewUrl = jobApi(job, "preview");
  useEffect(() => {
    const ranges = JSON.parse(cuts) as [number, number][];
    if (ranges.length === 0) {
      setLanded(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      void fetch(previewUrl, {
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
  }, [cuts, previewUrl]);

  // The word being said where the player is, lit on amber as a caption is, and kept in view while
  // the video plays.
  const now = playing.time * TICKS;
  const live = transcriptWords.findIndex((word) => word.start <= now && now < word.end);
  useEffect(() => {
    const box = transcript.current;
    if (!playing.playing || live < 0 || !box) return;
    const word = box.querySelector<HTMLElement>(`[data-word="${live}"]`);
    if (!word) return;
    const top = word.offsetTop - box.offsetTop;
    if (top < box.scrollTop || top + word.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTo({ top: Math.max(0, top - box.clientHeight / 3) });
    }
  }, [live, playing.playing]);

  const layout = (main: ReactNode, panel: ReactNode, foot?: ReactNode) => (
    <main className="grid lg:h-[calc(100dvh-3.5rem)] lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="flex min-h-0 min-w-0 flex-col">
        <Player job={job} video={video} />
        <div className="border-t bg-card px-4 py-3 lg:hidden">{download}</div>
        {main}
      </div>
      <aside
        className="flex min-h-0 flex-col border-l bg-card max-lg:border-t max-lg:border-l-0"
        aria-label={t.done.label}
      >
        <div className="shrink-0 border-b px-6 pt-5 pb-4 max-md:px-4">{head}</div>
        {panel}
        {foot}
      </aside>
    </main>
  );
  const resultOnly = <div className="min-h-0 flex-1 overflow-y-auto">{result}</div>;

  if (!editable || !view) {
    keys.current = () => {};
    return layout(
      editable && (
        <section className={cn(PANE, "justify-center px-5")} aria-label={words.label}>
          {error ? (
            <ErrorNote message={error} fallback={words.loadFallback} />
          ) : (
            <p className={HELP}>{words.loading}</p>
          )}
        </section>
      ),
      resultOnly,
    );
  }

  const count = changes(draft);
  // The kit chosen here, and whether the version made will draw a kit's custom captions.
  const chosenKit = draft.kit ? kits?.kits.find((each) => each.id === draft.kit?.id) : undefined;
  const brandCaptions =
    draft.kit === undefined ? Boolean(view.brand?.captions) : Boolean(chosenKit?.brand.captions);
  const shownCaptions = draft.captions ?? (brandCaptions ? "brand" : view.captions);
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
    const response = await fetch(jobApi(job, "versions"), {
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

  const transcriptPane = (
    <section className={PANE} aria-label={words.label}>
      <div className="flex items-start justify-between gap-6 px-5 pt-3">
        <div className="flex shrink-0 items-baseline gap-3">
          <h2 className={SLUG}>{words.transcript}</h2>
          <p className={cn(META, "truncate")}>
            {words.version(view.version, formatClock(view.length / TICKS))}
            {landed && (
              <>
                {words.afterCuts}
                <NumberTicker value={landed.length / TICKS} format={formatClock} />
              </>
            )}
          </p>
        </div>
        <p className="flex min-w-0 flex-wrap justify-end gap-x-4 gap-y-1 text-xs text-muted-foreground max-xl:hidden [&>span]:inline-flex [&>span]:items-center [&>span]:gap-1 [&>span]:whitespace-nowrap">
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
      </div>
      {transcriptWords.length === 0 ? (
        <p className={cn(HELP, "px-5 py-4")}>{words.noCaptions}</p>
      ) : (
        <>
          <Ruler
            length={view.length}
            asked={revision.cuts ?? []}
            landed={landed?.removed ?? []}
            at={now}
            onSeek={(ticks) => {
              const player = video.current;
              if (player) player.currentTime = ticks / TICKS;
            }}
          />
          <fieldset
            ref={transcript}
            className="relative mx-5 mb-2 min-h-0 min-w-0 flex-1 overflow-y-auto rounded-xl border bg-well px-4 py-2.5"
            aria-label={words.transcript}
            aria-describedby={`${job.id}-transcript-help`}
            onKeyDown={onTranscriptKey}
          >
            {view.lines.map((line, l) => (
              <p
                key={line.words[0]?.start ?? line.text}
                // The lines come in one after another, as captions do, when it first shows.
                className="leading-[1.95] animate-in fill-mode-backwards fade-in-0 slide-in-from-bottom-1 duration-500"
                style={{ animationDelay: `${Math.min(l, 12) * 45}ms` }}
              >
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
                        <span
                          key={t}
                          className="mx-px inline-flex translate-y-0.5 text-destructive"
                          title={words.lands(seconds(t))}
                        >
                          <Scissors className="size-3.5" aria-hidden="true" />
                        </span>
                      ))}
                      <button
                        type="button"
                        className={cn(
                          // A line struck through a word to cut draws across it.
                          "rounded-[4px] bg-[linear-gradient(currentColor,currentColor)] bg-[length:0%_1.5px] bg-[position:0_58%] bg-no-repeat px-px text-[15px] text-foreground transition-[color,background-color,background-size] duration-300 ease-(--ease-cut) hover:bg-raised focus-visible:outline-offset-1",
                          g === live && !state && "bg-primary text-primary-foreground",
                          state === "selected" &&
                            "bg-foreground text-background hover:bg-foreground",
                          state === "cut" && "bg-[length:100%_1.5px] text-muted-foreground",
                          state === "kept" &&
                            "underline decoration-muted-foreground decoration-dotted underline-offset-[3px]",
                          state === "gone" &&
                            "bg-destructive/15 bg-[length:100%_1.5px] text-destructive hover:bg-destructive/20",
                          state === "fixed" &&
                            "underline decoration-success underline-offset-[3px]",
                        )}
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
                          <span className="sr-only"> ({words.states[state]})</span>
                        )}
                      </button>
                    </Fragment>
                  );
                })}
              </p>
            ))}
            {marksAfterLast.map((t) => (
              <span key={t} className="text-destructive" title={words.lands(seconds(t))}>
                <Scissors className="inline size-3.5" aria-hidden="true" />
              </span>
            ))}
          </fieldset>
        </>
      )}
      <div className="flex max-h-[38%] shrink-0 flex-col gap-2 overflow-y-auto px-5 pb-3">
        {selection ? (
          <div className="flex flex-wrap items-center gap-2.5 animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
            <span className={HELP}>
              {words.selected(
                to - from + 1,
                words.span(
                  seconds((transcriptWords[from] as Word).start),
                  seconds((transcriptWords[to] as Word).end),
                ),
              )}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={deleteSelection}>
              <Scissors aria-hidden="true" />
              {words.delete}
            </Button>
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
            <Button type="button" variant="link" size="inline" onClick={() => setSelection(null)}>
              {words.clear}
            </Button>
          </div>
        ) : (
          draft.cuts.length === 0 && (
            <p className={cn(HELP, "line-clamp-2")} title={words.help}>
              {words.help}
            </p>
          )
        )}
        {/* Read by assistive tech whatever shows above. */}
        <p id={`${job.id}-transcript-help`} className="sr-only">
          {words.help}
        </p>
        {draft.cuts.length > 0 && (
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {draft.cuts.map(([a, b], i) => {
              const asked = revision.cuts?.[i];
              const span = asked && landed?.removed.find(([x, y]) => x < asked[1] && y > asked[0]);
              return (
                <li
                  key={`${a}-${b}`}
                  className="inline-flex max-w-full items-center gap-2 rounded-lg border bg-well py-1 pr-1 pl-2.5 text-xs text-steel animate-in fade-in-0 zoom-in-95 duration-200"
                >
                  <Scissors className="size-3 shrink-0 text-destructive" aria-hidden="true" />
                  <span className="min-w-0">
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
                        <span key={extra.words} className="text-foreground">
                          {words.outside(extra.words)}
                        </span>
                      ))}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2"
                    onClick={() => change({ ...draft, cuts: draft.cuts.filter((_, j) => j !== i) })}
                  >
                    <Undo2 aria-hidden="true" />
                    {words.undo}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );

  const tabs = [
    { value: "result", label: words.tabs.result, show: true },
    { value: "captions", label: words.tabs.captions, show: Boolean(view.captions) },
    { value: "music", label: words.tabs.music, show: true },
    { value: "look", label: words.tabs.look, show: true },
    {
      value: "graphics",
      label: words.tabs.graphics,
      show: view.titles.length > 0 || view.removables.length > 0,
    },
    { value: "replan", label: words.tabs.replan, show: true },
  ].filter((each) => each.show);

  const panel = (
    <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1">
      <TabsList aria-label={words.label}>
        {tabs.map(({ value, label }) => (
          <TabsTrigger key={value} value={value}>
            {label}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="result">{result}</TabsContent>

      {view.captions && (
        <TabsContent value="captions">
          <div className={SECTION}>
            <h3 className={SLUG}>{words.captionStyle}</h3>
            <div className="grid grid-cols-2 gap-2">
              {brandCaptions && (
                <button
                  type="button"
                  className={cn(CHOICE, "gap-1.5 p-1.5 pb-2 text-[13px] font-medium")}
                  aria-pressed={shownCaptions === "brand"}
                  onClick={() => {
                    const { captions: _, ...rest } = draft;
                    change(rest);
                  }}
                >
                  {chosenKit ? (
                    <KitCaptionPreview kit={chosenKit} />
                  ) : (
                    <CaptionPreview style="bold" />
                  )}
                  {t.kits.captionsName}
                </button>
              )}
              {CAPTION_STYLES.map((style) => (
                <button
                  key={style}
                  type="button"
                  className={cn(CHOICE, "gap-1.5 p-1.5 pb-2 text-[13px] font-medium")}
                  aria-pressed={shownCaptions === style}
                  onClick={() => {
                    const { captions: _, ...rest } = draft;
                    const unchanged =
                      style === view.captions && !view.brand?.captions && draft.kit === undefined;
                    change(unchanged ? rest : { ...draft, captions: style });
                  }}
                >
                  <CaptionPreview style={style} />
                  {t.captions[style].name}
                </button>
              ))}
            </div>
            <label className={CHECK}>
              <input
                type="checkbox"
                checked={draft.emoji ?? view.emoji}
                onChange={(event) => {
                  const { emoji: _, ...rest } = draft;
                  const emoji = event.target.checked;
                  change(emoji === view.emoji ? rest : { ...draft, emoji });
                }}
              />
              {words.emoji}
            </label>
            <p className={HELP}>{words.emojiHelp}</p>
          </div>
        </TabsContent>
      )}

      <TabsContent value="music">
        <div className={SECTION}>
          <h3 className={SLUG}>{words.music}</h3>
          {view.music && <p className={HELP}>{words.playing(view.music.name)}</p>}
          {view.music ? (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-2">
                <span className={cn(LABEL, "tabular-nums")}>
                  {words.volume}
                  <span className="font-normal text-muted-foreground">
                    {gainOf(draft) !== null &&
                      `${(gainOf(draft) ?? 0) > 0 ? "+" : ""}${gainOf(draft) ?? 0} dB`}
                  </span>
                </span>
                <input
                  type="range"
                  className="w-full"
                  min={-12}
                  max={6}
                  step={1}
                  disabled={gainOf(draft) === null}
                  value={gainOf(draft) ?? 0}
                  onChange={(event) => {
                    const gainDb = Number(event.target.value);
                    const { music: _, ...rest } = draft;
                    change(gainDb === 0 ? rest : { ...draft, music: { gainDb } });
                  }}
                />
              </label>
              <label className={CHECK}>
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
            <p className={HELP}>{words.noMusic}</p>
          )}
        </div>
        <div className={cn(SECTION, "border-t")}>
          <MusicPicker
            current={view.music}
            chosen={
              draft.music === "remove"
                ? null
                : draft.music && "track" in draft.music
                  ? draft.music.track
                  : undefined
            }
            onChoose={(track) => {
              const { music: _, ...rest } = draft;
              change(track ? { ...draft, music: { track: track.id, title: track.title } } : rest);
            }}
          />
        </div>
      </TabsContent>

      <TabsContent value="look">
        <div className={SECTION}>
          <h3 className={SLUG}>{words.look}</h3>
          <Segments
            className="flex-wrap"
            options={LOOKS.map((look) => ({ value: look as string, label: t.looks[look].name }))}
            value={draft.look ?? view.look}
            onChange={(look) => {
              const { look: _, ...rest } = draft;
              change(look === view.look ? rest : { ...draft, look });
            }}
          />
          <p className={HELP}>
            {t.looks[(draft.look ?? view.look) as keyof Messages["looks"]]?.description}
          </p>
        </div>
        <div className={cn(SECTION, "border-t")}>
          <h3 className={SLUG}>{t.kits.picker}</h3>
          <NativeSelect
            aria-label={t.kits.picker}
            value={draft.kit === undefined ? (view.brand ? "keep" : "") : (draft.kit?.id ?? "")}
            onChange={(event) => {
              const { kit: _, captions: __, ...rest } = draft;
              const picked = event.target.value;
              if (picked === "keep" || (picked === "" && !view.brand)) {
                change(draft.captions ? { ...rest, captions: draft.captions } : rest);
                return;
              }
              const chosen = kits?.kits.find((each) => each.id === picked);
              const kit = chosen ? { id: chosen.id, name: chosen.brand.name } : null;
              // A kit with custom captions draws them, in place of a style picked here.
              const keeps = draft.captions && !chosen?.brand.captions;
              change({ ...rest, kit, ...(keeps ? { captions: draft.captions } : {}) });
            }}
          >
            {view.brand && <option value="keep">{words.brandKeep(view.brand.name)}</option>}
            <option value="">{t.kits.none}</option>
            {kits?.kits.map((each) => (
              <option key={each.id} value={each.id}>
                {each.brand.name}
              </option>
            ))}
          </NativeSelect>
          <p className={HELP}>{words.brandHelp}</p>
        </div>
      </TabsContent>

      {(view.titles.length > 0 || view.removables.length > 0) && (
        <TabsContent value="graphics">
          {view.titles.length > 0 && (
            <div className={SECTION}>
              <h3 className={SLUG}>{words.titles}</h3>
              {view.titles.map((title) => (
                <div key={title.index} className="flex flex-col gap-3">
                  {Object.entries(title.limits).map(([name, limit]) => (
                    <div key={name} className="flex flex-col gap-2">
                      <label className={LABEL} htmlFor={`${job.id}-title-${title.index}-${name}`}>
                        {title.template === "title" ? "" : words.lowerThird}
                        {words.params[name] ?? name}
                      </label>
                      <Input
                        id={`${job.id}-title-${title.index}-${name}`}
                        maxLength={limit}
                        value={draft.titles[title.index]?.[name] ?? title.params[name] ?? ""}
                        onChange={(event) => {
                          const params = {
                            ...draft.titles[title.index],
                            [name]: event.target.value,
                          };
                          if (event.target.value === (title.params[name] ?? ""))
                            delete params[name];
                          const titles = { ...draft.titles, [title.index]: params };
                          if (Object.keys(params).length === 0) delete titles[title.index];
                          change({ ...draft, titles });
                        }}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
          {view.removables.length > 0 && (
            <div className={cn(SECTION, view.titles.length > 0 && "border-t")}>
              <h3 className={SLUG}>{words.overlays}</h3>
              <ul className={LIST}>
                {view.removables.map((item) => {
                  const id = `${item.kind}:${item.index}`;
                  const removed = draft.remove.includes(id);
                  return (
                    <li
                      key={id}
                      className="grid grid-cols-[3.5em_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-[13px]"
                    >
                      <button
                        type="button"
                        className="text-left text-xs text-muted-foreground tabular-nums hover:text-foreground"
                        onClick={() => {
                          const player = video.current;
                          if (player) player.currentTime = item.start / TICKS;
                        }}
                      >
                        {formatClock(item.start / TICKS)}
                      </button>
                      <span
                        className={cn("truncate", removed && "text-muted-foreground line-through")}
                      >
                        {overlayLabel(item.label, t)}
                      </span>
                      <Button
                        type="button"
                        variant={removed ? "outline" : "ghost"}
                        size="sm"
                        className="h-7"
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
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </TabsContent>
      )}

      <TabsContent value="replan">
        <div className={SECTION}>
          <h3 className={SLUG}>{words.replanTitle}</h3>
          <p className={HELP}>{words.replanHelp}</p>
          {view.older && <p className={HELP}>{words.older}</p>}
          {count > 0 && <p className={WARNING}>{words.unapplied(count, current)}</p>}
          {view.footage && !rendering ? (
            <Replan job={job} onJob={onJob} />
          ) : (
            <p className={HELP}>{view.footage ? words.replanWait : words.noFootage}</p>
          )}
        </div>
      </TabsContent>
    </Tabs>
  );

  // Apply, in the panel's foot whichever tab shows: the changes so far, or the new version
  // rendering.
  const foot = (
    <div className="flex shrink-0 flex-col gap-3 border-t bg-surface px-6 py-4 shadow-[0_-12px_24px_-16px_rgb(12_13_16/0.14)] max-lg:sticky max-lg:bottom-0 max-md:px-4">
      {error && <ErrorNote message={error} fallback={words.fallback} />}
      {job.render?.error && (
        <ErrorNote message={job.render.error} fallback={words.renderFallback} />
      )}
      {rendering ? (
        <div className="flex flex-col gap-2.5" aria-live="polite">
          <div className="flex justify-between gap-3 text-[13px] font-medium">
            <span className="min-w-0">
              {words.rendering(rendering.version, progressText(rendering.message, t))}
            </span>
            <span className="tabular-nums">{Math.floor(rendering.fraction * 100)}%</span>
          </div>
          <Bar fraction={rendering.fraction} />
          <div className="flex items-center gap-3">
            <p className={cn(HELP, "flex-1")}>{words.keepsPlaying(current)}</p>
            <Button type="button" variant="outline" size="sm" onClick={stop}>
              {words.stop}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <p className={cn(HELP, "line-clamp-3 flex-1")}>
            {blocked ?? words.renders(describe(draft, t), nextVersion(job))}
          </p>
          <Button
            type="button"
            size="lg"
            className="shrink-0"
            disabled={blocked !== null}
            onClick={() => void apply()}
          >
            {count > 0 ? words.applyCount(count) : words.apply}
          </Button>
        </div>
      )}
    </div>
  );

  // Re-plan has its own action, so Apply leaves the foot while it shows, unless a version renders.
  return layout(
    transcriptPane,
    panel,
    tab !== "replan" || rendering || job.render?.error ? foot : null,
  );
}

/** The transcript pane under the player: its height on a wide screen, and a stack below. */
const PANE =
  "flex shrink-0 flex-col gap-2 border-t bg-card lg:h-[clamp(240px,36vh,340px)] max-lg:min-h-80";

/** The player's time, in seconds, and whether it plays; kept current as it plays and seeks. */
function usePlayback(video: RefObject<HTMLVideoElement | null>) {
  const [state, setState] = useState({ time: 0, playing: false });
  useEffect(() => {
    const player = video.current;
    if (!player) return;
    const read = () => setState({ time: player.currentTime, playing: !player.paused });
    const events = ["timeupdate", "seeked", "play", "pause", "loadedmetadata"] as const;
    for (const name of events) player.addEventListener(name, read);
    read();
    return () => {
      for (const name of events) player.removeEventListener(name, read);
    };
  }, [video]);
  return state;
}

/** Seconds between labelled ticks, so a ruler has at most a dozen. */
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800];

/**
 * The edit's length as a timeline ruler over its sound: the stretches asked to be cut, where the
 * cuts land, and the ink playhead where the player is. A click plays from there; the keyboard
 * keeps the player's own controls and the transcript.
 */
function Ruler({
  length,
  asked,
  landed,
  at,
  onSeek,
}: {
  length: number;
  asked: readonly [number, number][];
  landed: readonly [number, number][];
  at: number;
  onSeek: (ticks: number) => void;
}) {
  const total = Math.max(1, length);
  const pct = (ticks: number) => `${(Math.min(Math.max(ticks, 0), total) / total) * 100}%`;
  const span = total / TICKS;
  const step = STEPS.find((each) => span / each <= 12) ?? 3600;
  // A label too near the end would run past it.
  const ticks = Array.from({ length: Math.floor(span / step) + 1 }, (_, i) => i * step).filter(
    (second) => second === 0 || second <= span * 0.96,
  );
  return (
    <div
      aria-hidden="true"
      className="relative mx-5 h-14 shrink-0 cursor-pointer select-none"
      onPointerDown={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        onSeek(((event.clientX - box.left) / box.width) * total);
      }}
    >
      {ticks.map((second) => (
        <span
          key={second}
          className="absolute top-0 flex h-5 items-start"
          style={{ left: pct(second * TICKS) }}
        >
          <span className="h-4 w-px bg-edge" />
          <span className="mt-px ml-1 text-[10px] leading-none text-muted-foreground tabular-nums">
            {formatClock(second)}
          </span>
        </span>
      ))}
      <div className="wave-keep absolute inset-x-0 bottom-0 h-7 rounded-md bg-well" />
      {asked.map(([a, b]) => (
        <span
          key={`a${a}`}
          className="absolute bottom-0 h-7 rounded-[3px] bg-foreground/15"
          style={{ left: pct(a), width: pct(b - a) }}
        />
      ))}
      {landed.map(([a, b]) => (
        <span
          key={`l${a}`}
          className="absolute bottom-0 h-7 rounded-[3px] border-x-2 border-destructive bg-destructive/35 animate-land"
          style={{ left: pct(a), width: pct(b - a) }}
        />
      ))}
      <span
        className="absolute top-3.5 bottom-0 w-0.5 -translate-x-1/2 rounded-full bg-foreground transition-[left] duration-300 ease-linear before:absolute before:-top-1 before:left-1/2 before:size-2.5 before:-translate-x-1/2 before:rotate-45 before:rounded-[2px] before:bg-primary before:ring-1 before:ring-foreground"
        style={{ left: pct(at) }}
      />
    </div>
  );
}

function WordFix({ text, onFix }: { text: string; onFix: (text: string) => void }) {
  const words = useT().reedit;
  const [value, setValue] = useState(text);
  return (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) onFix(value.trim());
      }}
    >
      <Input
        className="h-8 w-36"
        aria-label={words.word}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <Button type="submit" variant="outline" size="sm" disabled={!value.trim()}>
        {words.fix}
      </Button>
    </form>
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
    const response = await fetch(jobApi(job, `versions/${n}`), { method: "POST" });
    const body = (await response.json().catch(() => ({}))) as Job & { error?: string };
    if (!response.ok) setError(body.error ?? words.notShown);
    else {
      setError(null);
      onJob(body);
    }
  };
  return (
    <div className="flex flex-col gap-2.5">
      <h3 className={SLUG}>{words.title}</h3>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {[...versions].reverse().map((version) => (
          <li
            key={version.n}
            className={cn(
              "relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border px-3 py-2.5 animate-in fade-in-0 duration-300",
              // The version shown, in viewfinder corners as the work on screen.
              version.n === current &&
                "viewfinder border-transparent bg-raised [--cc:var(--foreground)] [--corner:9px] [--inset:0px]",
            )}
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[13px] font-medium">
                {words.version(version.n)}
                {version.n === current && words.shown}
              </span>
              <span className={META}>
                {t.date(version.created)}
                {version.seconds !== undefined && `${t.sep}${formatClock(version.seconds)}`}
                {version.claude && `${t.sep}Claude ${formatDollars(dollarsOf(version.claude), t)}`}
                {t.sep}
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
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void show(version.n)}
              >
                {version.video ? words.show : words.again}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <p className={HELP}>{words.kept}</p>
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

function toRevision(draft: Draft, words: readonly Word[]): PageRevision {
  const revision: PageRevision = {};
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
  if (draft.music) {
    revision.music =
      typeof draft.music === "object" && "track" in draft.music
        ? { track: draft.music.track }
        : draft.music;
  }
  if (draft.look) revision.look = draft.look as PageRevision["look"];
  if (draft.captions) revision.captions = draft.captions;
  if (draft.emoji !== undefined) revision.emoji = draft.emoji;
  if (draft.kit !== undefined) revision.kit = draft.kit?.id ?? null;
  return revision;
}

/** The music level the draft gives, in dB; null when it takes the music out or swaps the track,
 * which plays at the level the speech calls for. */
function gainOf(draft: Draft): number | null {
  if (draft.music === "remove" || (draft.music && "track" in draft.music)) return null;
  return draft.music?.gainDb ?? 0;
}

function changes(draft: Draft): number {
  return (
    draft.cuts.length +
    Object.keys(draft.words).length +
    Object.keys(draft.titles).length +
    draft.remove.length +
    (draft.music ? 1 : 0) +
    (draft.look ? 1 : 0) +
    (draft.captions ? 1 : 0) +
    (draft.emoji !== undefined ? 1 : 0) +
    (draft.kit !== undefined ? 1 : 0)
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
      : draft.music && "track" in draft.music
        ? words.track(draft.music.title)
        : draft.music && words.music(`${draft.music.gainDb > 0 ? "+" : ""}${draft.music.gainDb}`),
    draft.look &&
      words.look(draft.look, t.looks[draft.look as keyof Messages["looks"]]?.name ?? draft.look),
    draft.captions && words.captions(draft.captions, t.captions[draft.captions].name),
    draft.emoji !== undefined && words.emoji(draft.emoji),
    draft.kit !== undefined && (draft.kit ? words.brand(draft.kit.name) : words.noBrand),
  ].filter((part): part is string => Boolean(part));
  const text = parts.join(t.list);
  return text ? text[0]?.toUpperCase() + text.slice(1) : words.none;
}
