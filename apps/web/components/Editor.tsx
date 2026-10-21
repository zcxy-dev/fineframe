"use client";

import { estimateCost, estimateShortsCost } from "@video-editor/engine/estimate";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Picked } from "../lib/collect.ts";
import { durationOf } from "../lib/collect.ts";
import { fixFor } from "../lib/fixes.ts";
import { LOCALE_NAMES, LOCALES } from "../lib/i18n/locale.ts";
import type { Messages } from "../lib/i18n/messages.ts";
import type { Job } from "../lib/jobs.ts";
import type { Service } from "../lib/key.ts";
import type { Remembered } from "../lib/remembered.ts";
import {
  DEFAULT_CAPTIONS,
  DEFAULT_SHORT_RANGE,
  DEFAULT_SHORTS,
  DEFAULT_STYLE,
  DEFAULT_VISUALS,
  formatBytes,
  formatDollars,
  formatLength,
  instructionsProblem,
  namesFrom,
  roleOf,
  SHORT_RANGES,
} from "../lib/settings.ts";
import type { SetupState } from "../lib/setup.ts";
import { jobApi, shortView } from "../lib/shorts.ts";
import { dollarsOf, summaryRows } from "../lib/summary.ts";
import { BrandKits, useKits } from "./BrandKits.tsx";
import { ErrorNote } from "./ErrorNote.tsx";
import styles from "./editor.module.css";
import { Footage, type Item, type LinkItem } from "./Footage.tsx";
import { useLocale, useT } from "./I18n.tsx";
import { CaptionsIcon, CheckIcon, DownloadIcon, LockIcon } from "./icons.tsx";
import { KeyDialog } from "./KeyDialog.tsx";
import { Projects } from "./Projects.tsx";
import { ReEdit, Versions } from "./ReEdit.tsx";
import { Player, ResultSummary, useVideoLength } from "./ResultView.tsx";
import { DownloadView, RunView } from "./RunView.tsx";
import { type Choices, chosenLength, type Machine, SettingsPanel } from "./SettingsPanel.tsx";
import { ShortsDone, ShortsGrid, ShortsKept, ShortText } from "./Shorts.tsx";

/** What /api/key says: which keys the server has, never the keys. */
type Keys = { set: boolean; openrouter: boolean; pexels: boolean; pixabay: boolean };

/** What /api/setup says: whether the analysis can run yet, and this computer's memory. */
type Setup = SetupState & Machine & { asr: Choices["asr"] };

type Phase =
  | { kind: "compose"; error?: string }
  | { kind: "uploading"; job: Job; sent: number; total: number; file: number }
  | { kind: "job"; job: Job };

const FINISHED: Job["status"][] = ["done", "error", "cancelled"];

/** Whether the job is still changing: the edit runs, or a version of it renders. */
function live(job: Job): boolean {
  return !FINISHED.includes(job.status) || (job.render !== undefined && !job.render.error);
}

/** The edit the page shows goes in its address, so a reload or a bookmark opens it again. */
function showInAddress(id: string | null): void {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("job", id);
  else url.searchParams.delete("job");
  window.history.replaceState(null, "", url);
}

export function Editor() {
  const t = useT();
  const { locale, choose } = useLocale();
  const [items, setItems] = useState<Item[]>([]);
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [choices, setChoices] = useState<Choices>({
    make: "one",
    range: SHORT_RANGES.indexOf(DEFAULT_SHORT_RANGE),
    count: DEFAULT_SHORTS,
    preset: 60,
    custom: "",
    aspect: "9:16",
    style: DEFAULT_STYLE,
    names: "",
    terms: "",
    musicLicense: "",
    asr: "local",
    visuals: DEFAULT_VISUALS,
    quality: "best",
    correct: false,
    captions: DEFAULT_CAPTIONS,
    brand: null,
    instructions: "",
  });
  // The Brand kit page, over the rest while it shows.
  const [kitsOpen, setKitsOpen] = useState(false);
  const { list: kits, reload: reloadKits } = useKits();
  // The default kit until the owner chooses, its custom captions with it.
  const [brandChosen, setBrandChosen] = useState(false);
  useEffect(() => {
    if (!kits || brandChosen) return;
    const kit = kits.kits.find((each) => each.id === kits.default) ?? null;
    setChoices((current) => ({
      ...current,
      brand: kit?.id ?? null,
      captions: kit?.brand.captions
        ? "brand"
        : current.captions === "brand"
          ? DEFAULT_CAPTIONS
          : current.captions,
    }));
  }, [kits, brandChosen]);
  const [phase, setPhase] = useState<Phase>({ kind: "compose" });
  const upload = useRef<XMLHttpRequest | null>(null);
  // The finished edit's player, which the re-edit's shortcuts play and step.
  const video = useRef<HTMLVideoElement>(null);
  // Whether the server has an Anthropic key, an OpenRouter one and the optional stock footage
  // ones (never the keys); null until it says.
  const [keys, setKeys] = useState<Keys | null>(null);
  const keySet = keys?.set ?? null;
  const [asking, setAsking] = useState<Service | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);

  // The first time, with no key yet, the page asks for one.
  useEffect(() => {
    void fetch("/api/key")
      .then((response) => response.json() as Promise<Keys>)
      .then((found) => {
        setKeys(found);
        if (!found.set) setAsking("anthropic");
      })
      .catch(() => {});
  }, []);

  // The names and terms of the last edit, unless the owner has typed some already.
  useEffect(() => {
    void fetch("/api/remembered")
      .then((response) => response.json() as Promise<Remembered>)
      .then((found) =>
        setChoices((choices) => ({
          ...choices,
          names: choices.names || found.names.join("\n"),
          terms: choices.terms || found.terms.join("\n"),
        })),
      )
      .catch(() => {});
  }, []);

  // Whether the analysis can run yet, followed while it is set up; and where speech is heard
  // unless the owner chooses, from this computer's memory.
  const installing = setup === null || setup.state === "installing";
  useEffect(() => {
    if (!installing) return;
    let live = true;
    const read = () =>
      fetch("/api/setup")
        .then((response) => response.json() as Promise<Setup>)
        .then((found) => {
          if (!live) return;
          setSetup((current) => {
            if (!current) setChoices((choices) => ({ ...choices, asr: found.asr }));
            return found;
          });
        })
        .catch(() => {});
    void read();
    const timer = setInterval(read, 1000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [installing]);

  // The page reopens on the edit in its address, or else on one that is running. One whose
  // files were still being sent cannot go on: the browser no longer has them.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("job");
    void fetch(id ? `/api/jobs/${encodeURIComponent(id)}` : "/api/jobs/latest")
      .then((response) => (response.ok ? (response.json() as Promise<Job | null>) : null))
      .then((job) => {
        const open = job && job.status !== "uploading" && (id || job.status === "running");
        if (!open) {
          showInAddress(null);
          return;
        }
        setPhase((current) => (current.kind === "compose" ? { kind: "job", job } : current));
      })
      .catch(() => {});
  }, []);

  const shown = phase.kind === "job" ? phase.job.id : null;
  useEffect(() => {
    if (shown) showInAddress(shown);
    else if (phase.kind === "compose") showInAddress(null);
  }, [shown, phase.kind]);

  // Live progress while the edit runs, or a version of it renders.
  const watching =
    phase.kind === "job" && (phase.job.status === "running" || live(phase.job))
      ? phase.job.id
      : null;
  useEffect(() => {
    if (!watching) return;
    const events = new EventSource(`/api/jobs/${watching}/events`);
    events.onmessage = (event) => {
      const job = JSON.parse(event.data) as Job;
      setPhase((current) =>
        current.kind === "job" && current.job.id === job.id ? { kind: "job", job } : current,
      );
      if (!live(job)) events.close();
    };
    return () => events.close();
  }, [watching]);

  const add = useCallback((picked: Picked[]) => {
    let left = 0;
    setItems((current) => {
      const next = [...current];
      const paths = new Set(next.map((item) => item.path));
      for (const { path, file } of picked) {
        const use = roleOf(path);
        if (!use) {
          left += 1;
          continue;
        }
        const same = next.find((item) => item.path === path);
        if (same && same.file.size === file.size) continue;
        let unique = path;
        for (let n = 2; paths.has(unique); n++) unique = path.replace(/(\.[^./]+)?$/, ` (${n})$1`);
        paths.add(unique);
        next.push({ key: `${unique}:${file.size}:${file.lastModified}`, path: unique, file, use });
      }
      return next.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
    });
    setSkipped((count) => count + left);
  }, []);

  // Each link pasted, read by the server for its title and length; one it cannot import is
  // left out, saying why.
  const addLinks = useCallback(
    (text: string) => {
      const urls = [...new Set(text.split(/\s+/).filter(Boolean))];
      setLinkError(null);
      setLinks((current) => [
        ...current,
        ...urls.filter((url) => !current.some((link) => link.url === url)).map((url) => ({ url })),
      ]);
      for (const url of urls) {
        void fetch("/api/links", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        })
          .then(async (response) => {
            const read = (await response.json()) as LinkItem["video"] & { error?: string };
            if (!response.ok) throw new Error(read.error ?? t.compose.refused);
            setLinks((current) =>
              current.map((link) => (link.url === url ? { url, video: read } : link)),
            );
          })
          .catch((error: Error) => {
            setLinks((current) => current.filter((link) => link.url !== url));
            setLinkError(t.footage.linkFailed(url, error.message));
          });
      }
    },
    [t],
  );

  // Each video's and track's length, read from its header one at a time, for the totals and the
  // warning.
  useEffect(() => {
    const next = items.find((item) => item.use !== "image" && item.duration === undefined);
    if (!next) return;
    let live = true;
    void durationOf(next.file).then((duration) => {
      if (!live) return;
      setItems((current) =>
        current.map((item) => (item.key === next.key ? { ...item, duration } : item)),
      );
    });
    return () => {
      live = false;
    };
  }, [items]);

  const used = items.filter((item) => !item.off);
  const hasVideo = used.some((item) => item.use === "video") || links.length > 0;
  const music = used.filter((item) => item.use === "music").length;
  const footageSeconds = useMemo(
    () =>
      items.reduce((sum, item) => sum + (item.use === "video" ? (item.duration ?? 0) : 0), 0) +
      links.reduce((sum, link) => sum + (link.video?.seconds ?? 0), 0),
    [items, links],
  );
  const range = SHORT_RANGES[choices.range] ?? DEFAULT_SHORT_RANGE;
  const several = choices.make === "shorts";
  // Several shorts are each within the range, the edit's length its longest.
  const length = several ? { seconds: range[1] } : chosenLength(choices, t);
  const estimate =
    "seconds" in length && footageSeconds > 0
      ? several
        ? estimateShortsCost(footageSeconds, choices.count, range, choices.visuals)
        : estimateCost(footageSeconds, length.seconds, choices.visuals)
      : null;
  const blocked =
    setup?.state === "installing"
      ? t.compose.installing
      : setup?.state === "failed"
        ? t.compose.setupFailed
        : links.some((link) => !link.video)
          ? t.footage.reading
          : !hasVideo
            ? items.length === 0
              ? t.compose.addFootage
              : t.compose.addVideo
            : "problem" in length
              ? length.problem
              : (instructionsProblem(choices.instructions, t) ??
                (music > 0 && !choices.musicLicense.trim() ? t.compose.musicLicense : null));

  /** Sends the footage and starts the edit; `instructions` are what the box holds unless a
   * retry gives the failed edit's own. */
  const start = async (instructions = choices.instructions) => {
    if (blocked || !("seconds" in length)) return;
    if (keySet === false) {
      setAsking("anthropic");
      return;
    }
    if (choices.asr === "cloud" && keys?.openrouter === false) {
      setAsking("openrouter");
      return;
    }
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            length: length.seconds,
            aspect: choices.aspect,
            style: choices.style,
            names: namesFrom(choices.names),
            terms: namesFrom(choices.terms),
            ...(music > 0 ? { musicLicense: choices.musicLicense.trim() } : {}),
            asr: choices.asr,
            visuals: choices.visuals,
            quality: choices.quality,
            correct: choices.correct,
            captions: choices.captions,
            ...(choices.brand ? { brand: choices.brand } : {}),
            // Nothing asked, nothing sent: the request is the same as without the box.
            ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
            ...(several ? { shorts: { count: choices.count, min: range[0], max: range[1] } } : {}),
          },
          files: used.map((item) => ({ path: item.path, size: item.file.size })),
          links: links.map((link) => link.url),
        }),
      });
      const created = (await response.json()) as Job & { error?: string; code?: string };
      if (!response.ok) {
        if (created.code === "key" || created.code === "openrouter") {
          const service = created.code === "key" ? "anthropic" : "openrouter";
          setKeys(
            (current) =>
              current && { ...current, [service === "anthropic" ? "set" : "openrouter"]: false },
          );
          setAsking(service);
        }
        setPhase({ kind: "compose", error: created.error ?? t.compose.refused });
        return;
      }
      const total = used.reduce((sum, item) => sum + item.file.size, 0);
      let sent = 0;
      setPhase({ kind: "uploading", job: created, sent, total, file: 0 });
      for (const [index, item] of used.entries()) {
        await put(`/api/jobs/${created.id}/files/${index}`, item.file, upload, t, (loaded) =>
          setPhase({ kind: "uploading", job: created, sent: sent + loaded, total, file: index }),
        );
        sent += item.file.size;
      }
      const started = await fetch(`/api/jobs/${created.id}/start`, { method: "POST" });
      const job = (await started.json()) as Job & { error?: string };
      if (!started.ok) throw new Error(job.error ?? t.compose.notStarted);
      // What was asked of this edit is for its footage only; the next one starts empty. An edit
      // that never started keeps it, to try again.
      setChoices((current) => ({ ...current, instructions: "" }));
      setPhase({ kind: "job", job });
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      setPhase({ kind: "compose", error: (error as Error).message });
    }
  };

  const cancel = async (job: Job) => {
    upload.current?.abort();
    const response = await fetch(`/api/jobs/${job.id}`, { method: "DELETE" });
    const cancelled = (await response.json()) as Job;
    setPhase(
      phase.kind === "uploading"
        ? { kind: "compose" }
        : { kind: "job", job: response.ok ? cancelled : job },
    );
  };

  const open = async (id: string) => {
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(id)}`);
      const job = (await response.json()) as Job & { error?: string };
      setPhase(response.ok ? { kind: "job", job } : { kind: "compose", error: job.error });
    } catch {
      setPhase({ kind: "compose", error: t.compose.openFailed });
    }
  };

  // The job as a request that changed it returned it, for the page to follow from there.
  const update = (changed: Job) =>
    setPhase((current) =>
      current.kind === "job" && current.job.id === changed.id
        ? { kind: "job", job: changed }
        : current,
    );

  const job = phase.kind === "compose" ? null : phase.job;
  const status = phase.kind === "job" ? phase.job.status : null;
  // The short opened from the grid, shown as an edit of its own.
  const [opened, setOpened] = useState<string | null>(null);
  const one = job && opened ? shortView(job, opened) : null;
  useEffect(() => {
    if (!job?.shorts?.some((short) => short.folder === opened)) setOpened(null);
  }, [job, opened]);

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <span className={styles.brand}>
          <Image src="/icon.svg" width={32} height={32} alt="" loading="eager" />
          <span className={styles.wordmark}>Fineframe</span>
        </span>
        <div className={styles.headerTools}>
          <button
            type="button"
            className={styles.keyButton}
            aria-pressed={kitsOpen}
            onClick={() => {
              if (kitsOpen) reloadKits();
              setKitsOpen(!kitsOpen);
            }}
          >
            {t.kits.menu}
          </button>
          {LOCALES.filter((each) => each !== locale).map((other) => (
            <button
              key={other}
              type="button"
              className={styles.keyButton}
              lang={other}
              aria-label={`${t.header.language}: ${LOCALE_NAMES[other]}`}
              onClick={() => choose(other)}
            >
              {LOCALE_NAMES[other]}
            </button>
          ))}
          {keySet !== null && (
            <button
              type="button"
              className={styles.keyButton}
              onClick={() => setAsking("anthropic")}
            >
              {keySet ? (
                <>
                  <CheckIcon width={14} height={14} />
                  {t.header.keySaved}
                </>
              ) : (
                t.header.addKey
              )}
            </button>
          )}
        </div>
      </header>
      <KeyDialog
        service={asking ?? "anthropic"}
        open={asking !== null}
        replacing={keys?.[asking === "anthropic" || asking === null ? "set" : asking] === true}
        onClose={() => setAsking(null)}
        onSaved={() => {
          const service = asking ?? "anthropic";
          setKeys((current) => ({
            set: service === "anthropic" || (current?.set ?? false),
            openrouter: service === "openrouter" || (current?.openrouter ?? false),
            pexels: service === "pexels" || (current?.pexels ?? false),
            pixabay: service === "pixabay" || (current?.pixabay ?? false),
          }));
          setAsking(null);
          setPhase((current) => (current.kind === "compose" ? { kind: "compose" } : current));
        }}
      />

      {kitsOpen ? (
        <BrandKits
          onClose={() => {
            reloadKits();
            setKitsOpen(false);
          }}
        />
      ) : phase.kind === "compose" || phase.kind === "uploading" ? (
        <main className={styles.layout}>
          <div className={styles.main}>
            <div className={styles.hero}>
              <h1 className={styles.title}>{t.compose.title}</h1>
              <p className={styles.lede}>{t.compose.lede}</p>
            </div>
            {setup && setup.state !== "ready" && (
              <SetupView setup={setup} onRetry={() => void retrySetup().then(setSetup)} />
            )}
            <Footage
              items={items}
              links={links}
              linkError={linkError}
              skipped={skipped}
              onAdd={add}
              onAddLinks={addLinks}
              onRemoveLink={(url) =>
                setLinks((current) => current.filter((link) => link.url !== url))
              }
              onRemove={(key) => setItems((current) => current.filter((item) => item.key !== key))}
              onToggle={(key) =>
                setItems((current) =>
                  current.map((item) => (item.key === key ? { ...item, off: !item.off } : item)),
                )
              }
              onClear={() => {
                setItems([]);
                setLinks([]);
                setLinkError(null);
                setSkipped(0);
              }}
            />
            {phase.kind === "compose" && <Projects onOpen={(id) => void open(id)} />}
          </div>

          <aside
            className={`${styles.card} ${styles.panel} ${styles.dock}`}
            aria-label={t.compose.settings}
          >
            <SettingsPanel
              choices={choices}
              onChange={setChoices}
              footageSeconds={footageSeconds}
              music={music}
              machine={setup}
              openrouter={keys?.openrouter ?? null}
              onAddOpenRouter={() => setAsking("openrouter")}
              stock={keys}
              onAddStock={setAsking}
              kits={kits?.kits ?? null}
              onBrand={() => setBrandChosen(true)}
              onEditKits={() => setKitsOpen(true)}
            />
            {phase.kind === "compose" && phase.error && (
              <ErrorNote message={phase.error} fallback={t.compose.startFallback} />
            )}
            {phase.kind === "uploading" ? (
              <div className={styles.uploading}>
                <div className={styles.uploadHead}>
                  <span>{t.compose.sending(phase.file + 1, used.length)}</span>
                  <span className={styles.tabular}>
                    {Math.floor((phase.sent / Math.max(1, phase.total)) * 100)}%
                  </span>
                </div>
                <div className={styles.bar}>
                  <div
                    className={styles.barFill}
                    style={{ width: `${(phase.sent / Math.max(1, phase.total)) * 100}%` }}
                  />
                </div>
                <p className={styles.help}>
                  {t.compose.of(formatBytes(phase.sent), formatBytes(phase.total))}
                </p>
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => void cancel(phase.job)}
                >
                  {t.compose.cancel}
                </button>
              </div>
            ) : (
              <div className={styles.go}>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={blocked !== null}
                  onClick={() => void start()}
                >
                  {several
                    ? t.compose.makeShorts(choices.count)
                    : "seconds" in length
                      ? t.compose.make(formatLength(length.seconds, t))
                      : t.compose.makeVideo}
                </button>
                {blocked ? (
                  <p className={styles.help}>{blocked}</p>
                ) : keySet === false ? (
                  <p className={styles.help}>{t.compose.needAnthropic}</p>
                ) : choices.asr === "cloud" && keys?.openrouter === false ? (
                  <p className={styles.help}>{t.compose.needOpenRouter}</p>
                ) : (
                  estimate && (
                    <p className={styles.help}>
                      {(several ? t.compose.estimateShorts : t.compose.estimate)(
                        formatDollars(estimate.low, t),
                        formatDollars(estimate.high, t),
                      )}
                    </p>
                  )
                )}
              </div>
            )}
            <p className={styles.note}>
              <LockIcon width={14} height={14} />
              <span>
                {choices.asr === "cloud" ? t.compose.privacyCloud : t.compose.privacyLocal}
              </span>
            </p>
          </aside>
        </main>
      ) : (
        <main className={styles.layout} data-status={status ?? undefined}>
          <div className={styles.main}>
            {one ? (
              <>
                <Player job={one} video={video} />
                {/* A short of a run stopped or cancelled before it ended does not change. */}
                {status === "done" && <ReEdit job={one} onJob={update} video={video} />}
              </>
            ) : status === "done" && job && !job.settings.shorts ? (
              <>
                <Player job={job} video={video} />
                <ReEdit job={job} onJob={update} video={video} />
              </>
            ) : (
              job && (
                <>
                  {status !== "done" && <RunView job={job} />}
                  {job.settings.shorts && (job.shorts?.length || status === "running") && (
                    <ShortsGrid job={job} onOpen={setOpened} />
                  )}
                </>
              )
            )}
          </div>
          <aside className={`${styles.card} ${styles.panel}`} aria-label={t.done.label}>
            {status === "running" && job && <Running job={job} onCancel={() => cancel(job)} />}
            {one && (
              <Done
                job={one}
                onJob={update}
                onNew={() => setPhase({ kind: "compose" })}
                onBack={() => setOpened(null)}
                fixed={status !== "done"}
              />
            )}
            {status === "done" && job && !one && job.settings.shorts && (
              <>
                <ShortsDone job={job} />
                <Summary job={job} />
                <div className={styles.block}>
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() => setPhase({ kind: "compose" })}
                  >
                    {t.done.another}
                  </button>
                </div>
              </>
            )}
            {status === "done" && job && !one && !job.settings.shorts && (
              <Done job={job} onJob={update} onNew={() => setPhase({ kind: "compose" })} />
            )}
            {(status === "error" || status === "cancelled") && job && !one && (
              <Failed
                job={job}
                onBack={() => setPhase({ kind: "compose" })}
                onRetry={
                  blocked === null
                    ? () => {
                        // The footage is still here: the same edit again, as it was asked for.
                        const asked = job.settings.instructions ?? "";
                        setChoices((current) => ({ ...current, instructions: asked }));
                        setPhase({ kind: "compose" });
                        void start(asked);
                      }
                    : null
                }
                onReplaceKey={(service) => setAsking(service)}
              />
            )}
            {(status === "error" || status === "cancelled") && job && !one && job.shorts?.length ? (
              <ShortsKept job={job} />
            ) : null}
          </aside>
        </main>
      )}
    </div>
  );
}

function Running({ job, onCancel }: { job: Job; onCancel: () => void }) {
  const t = useT();
  const [sure, setSure] = useState(false);
  useEffect(() => {
    if (!sure) return;
    const timer = setTimeout(() => setSure(false), 4000);
    return () => clearTimeout(timer);
  }, [sure]);
  return (
    <>
      <Summary job={job} />
      <div className={styles.block}>
        <button
          type="button"
          className={sure ? `${styles.button} ${styles.danger}` : styles.button}
          onClick={() => (sure ? onCancel() : setSure(true))}
        >
          {sure ? t.run.sure : t.run.cancel}
        </button>
        <p className={styles.help}>{t.run.closeable}</p>
      </div>
    </>
  );
}

/** A finished edit, or one short of several with its title, description and hashtags and a way
 * back to the others. */
function Done({
  job,
  onJob,
  onNew,
  onBack,
  fixed = false,
}: {
  job: Job;
  onJob: (job: Job) => void;
  onNew: () => void;
  onBack?: () => void;
  /** A short of a run stopped or cancelled before it ended: downloads only, no versions. */
  fixed?: boolean;
}) {
  const t = useT();
  const seconds = useVideoLength(job);
  const short = job.shorts?.find((each) => each.folder === job.short);
  const download = { download: "" };
  return (
    <>
      <div className={styles.block}>
        {onBack && (
          <button type="button" className={styles.linkButton} onClick={onBack}>
            ← {t.shorts.back}
          </button>
        )}
        <div>
          <h2 className={styles.panelTitle}>{short ? short.title : t.done.ready}</h2>
          <ResultSummary job={job} seconds={seconds} />
        </div>
        <div className={styles.downloads}>
          <a className={styles.primary} href={jobApi(job, "video", download)} download>
            <DownloadIcon width={18} height={18} />
            {t.done.download}
          </a>
          {job.result?.captions && (
            <a className={styles.button} href={jobApi(job, "captions", download)} download>
              <CaptionsIcon width={18} height={18} />
              {t.done.downloadCaptions}
            </a>
          )}
          {job.result?.broll && (
            <a className={styles.button} href={jobApi(job, "broll", download)} download>
              <DownloadIcon width={18} height={18} />
              {t.done.downloadCredits}
            </a>
          )}
        </div>
      </div>
      {short && <ShortText short={short} />}
      {fixed ? (
        <p className={styles.help}>{t.shorts.unchangeable(job.status === "cancelled")}</p>
      ) : (
        <Versions job={job} onJob={onJob} />
      )}
      <Summary job={job} actual={seconds} />
      <div className={styles.block}>
        <button type="button" className={styles.linkButton} onClick={onBack ?? onNew}>
          {onBack ? t.shorts.back : t.done.another}
        </button>
      </div>
    </>
  );
}

function Failed({
  job,
  onBack,
  onRetry,
  onReplaceKey,
}: {
  job: Job;
  onBack: () => void;
  /** Starts the same edit again from the footage still in the page; null when it is gone. */
  onRetry: (() => void) | null;
  onReplaceKey: (service: "anthropic" | "openrouter") => void;
}) {
  const t = useT();
  const cancelled = job.status === "cancelled";
  const fix = !cancelled && job.error ? fixFor(job.error, t) : null;
  const spent = job.claude ? dollarsOf(job.claude) : null;
  // The step that fixes it first, then trying again, then the footage; the first is primary.
  const actions = [
    fix?.kind === "key" && { label: t.failed.replaceKey, run: () => onReplaceKey("anthropic") },
    fix?.kind === "openrouter" && {
      label: t.failed.replaceOpenRouter,
      run: () => onReplaceKey("openrouter"),
    },
    fix?.kind === "credit" && {
      label: t.failed.addCredit,
      href: "https://console.anthropic.com/settings/billing",
    },
    // The same files and length would fail the same way.
    onRetry &&
      fix?.kind !== "file" &&
      fix?.kind !== "length" && { label: t.failed.retry, run: onRetry },
    {
      label: fix?.kind === "file" ? t.failed.changeFootage : t.failed.back,
      run: onBack,
    },
  ].filter((action) => action !== false && action !== null);
  return (
    <div className={styles.block}>
      <h2 className={styles.panelTitle}>{cancelled ? t.failed.cancelled : t.failed.title}</h2>
      {!cancelled && (
        <ErrorNote message={job.error ?? t.failed.wrong} fallback={t.failed.fallback} />
      )}
      {spent !== null && spent !== 0 && (
        <p className={styles.help}>{t.failed.spent(formatDollars(spent, t))}</p>
      )}
      <div className={styles.actions}>
        {actions.map((action, i) => {
          const className = i === 0 ? styles.primary : styles.button;
          return "href" in action ? (
            <a
              key={action.label}
              className={className}
              href={action.href}
              target="_blank"
              rel="noreferrer"
            >
              {action.label}
            </a>
          ) : (
            <button key={action.label} type="button" className={className} onClick={action.run}>
              {action.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Summary({ job, actual }: { job: Job; actual?: number | null }) {
  const rows = summaryRows(job, actual, useT());
  return (
    <dl className={styles.summary}>
      {rows.map(([name, value]) => (
        <div key={name} className={styles.summaryRow}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The analysis's setup on the desktop app's first start: its download, or why it failed. */
function SetupView({ setup, onRetry }: { setup: Setup; onRetry: () => void }) {
  const t = useT();
  return (
    <section className={`${styles.card} ${styles.setup}`} aria-label={t.setup.title}>
      <div>
        <h2 className={styles.panelTitle}>
          {setup.state === "failed" ? t.setup.failed : t.setup.title}
        </h2>
        <p className={styles.help}>{t.setup.about}</p>
      </div>
      {setup.state === "failed" ? (
        <ErrorNote message={setup.error ?? t.failed.wrong} fallback={t.setup.fallback}>
          <button type="button" className={styles.button} onClick={onRetry}>
            {t.setup.retry}
          </button>
        </ErrorNote>
      ) : setup.download ? (
        <DownloadView download={setup.download} />
      ) : (
        <p className={styles.help}>{t.setup.starting}</p>
      )}
    </section>
  );
}

async function retrySetup(): Promise<Setup> {
  const response = await fetch("/api/setup", { method: "POST" });
  return (await response.json()) as Setup;
}

/** Sends a file as a request body, reporting the bytes sent; fetch cannot report them. */
function put(
  url: string,
  file: File,
  current: { current: XMLHttpRequest | null },
  t: Messages,
  onProgress: (loaded: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    current.current = request;
    request.open("PUT", url);
    request.upload.onprogress = (event) => onProgress(event.loaded);
    request.onload = () => {
      current.current = null;
      if (request.status < 300) resolve();
      else {
        let error: string | undefined;
        try {
          error = (JSON.parse(request.responseText) as { error?: string }).error;
        } catch {
          // A proxy's or the framework's own error page, not the server's JSON.
        }
        reject(new Error(error ?? t.compose.notSentStatus(file.name, request.status)));
      }
    };
    request.onerror = () => {
      current.current = null;
      reject(new Error(t.compose.notSent(file.name)));
    };
    request.onabort = () => {
      current.current = null;
      reject(Object.assign(new Error("Cancelled"), { name: "AbortError" }));
    };
    request.send(file);
  });
}
