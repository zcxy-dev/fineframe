"use client";

import { estimateCost } from "@video-editor/engine/estimate";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Picked } from "../lib/collect.ts";
import { durationOf } from "../lib/collect.ts";
import { fixFor } from "../lib/fixes.ts";
import type { Job } from "../lib/jobs.ts";
import type { Service } from "../lib/key.ts";
import type { Remembered } from "../lib/remembered.ts";
import {
  DEFAULT_CAPTIONS,
  DEFAULT_STYLE,
  DEFAULT_VISUALS,
  formatBytes,
  formatDollars,
  formatLength,
  namesFrom,
  roleOf,
  styleName,
} from "../lib/settings.ts";
import type { SetupState } from "../lib/setup.ts";
import styles from "./editor.module.css";
import { Footage, type Item } from "./Footage.tsx";
import { AlertIcon, CaptionsIcon, CheckIcon, DownloadIcon, LockIcon, Mark } from "./icons.tsx";
import { KeyDialog } from "./KeyDialog.tsx";
import { Projects } from "./Projects.tsx";
import { Player, ResultSummary } from "./ResultView.tsx";
import { DownloadView, RunView } from "./RunView.tsx";
import { type Choices, chosenLength, type Machine, SettingsPanel } from "./SettingsPanel.tsx";

/** What /api/key says: which keys the server has, never the keys. */
type Keys = { set: boolean; openrouter: boolean; pexels: boolean; pixabay: boolean };

/** What /api/setup says: whether the analysis can run yet, and this computer's memory. */
type Setup = SetupState & Machine & { asr: Choices["asr"] };

type Phase =
  | { kind: "compose"; error?: string }
  | { kind: "uploading"; job: Job; sent: number; total: number; file: number }
  | { kind: "job"; job: Job };

const FINISHED: Job["status"][] = ["done", "error", "cancelled"];

/** The edit the page shows goes in its address, so a reload or a bookmark opens it again. */
function showInAddress(id: string | null): void {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("job", id);
  else url.searchParams.delete("job");
  window.history.replaceState(null, "", url);
}

export function Editor() {
  const [items, setItems] = useState<Item[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [choices, setChoices] = useState<Choices>({
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
  });
  const [phase, setPhase] = useState<Phase>({ kind: "compose" });
  const upload = useRef<XMLHttpRequest | null>(null);
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

  // Live progress while the edit runs.
  const watching = phase.kind === "job" && phase.job.status === "running" ? phase.job.id : null;
  useEffect(() => {
    if (!watching) return;
    const events = new EventSource(`/api/jobs/${watching}/events`);
    events.onmessage = (event) => {
      const job = JSON.parse(event.data) as Job;
      setPhase((current) =>
        current.kind === "job" && current.job.id === job.id ? { kind: "job", job } : current,
      );
      if (FINISHED.includes(job.status)) events.close();
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
  const hasVideo = used.some((item) => item.use === "video");
  const music = used.filter((item) => item.use === "music").length;
  const footageSeconds = useMemo(
    () => items.reduce((sum, item) => sum + (item.use === "video" ? (item.duration ?? 0) : 0), 0),
    [items],
  );
  const length = chosenLength(choices);
  const estimate =
    "seconds" in length && footageSeconds > 0 ? estimateCost(footageSeconds, length.seconds) : null;
  const blocked =
    setup?.state === "installing"
      ? "Setting up the analysis first"
      : setup?.state === "failed"
        ? "The analysis could not be set up"
        : !hasVideo
          ? items.length === 0
            ? "Add footage to start"
            : "Add at least one video: the edit is cut from video"
          : "problem" in length
            ? length.problem
            : music > 0 && !choices.musicLicense.trim()
              ? "Say under which licence you use the music"
              : null;

  const start = async () => {
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
          },
          files: used.map((item) => ({ path: item.path, size: item.file.size })),
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
        setPhase({ kind: "compose", error: created.error ?? "The server refused the edit" });
        return;
      }
      const total = used.reduce((sum, item) => sum + item.file.size, 0);
      let sent = 0;
      setPhase({ kind: "uploading", job: created, sent, total, file: 0 });
      for (const [index, item] of used.entries()) {
        await put(`/api/jobs/${created.id}/files/${index}`, item.file, upload, (loaded) =>
          setPhase({ kind: "uploading", job: created, sent: sent + loaded, total, file: index }),
        );
        sent += item.file.size;
      }
      const started = await fetch(`/api/jobs/${created.id}/start`, { method: "POST" });
      const job = (await started.json()) as Job & { error?: string };
      if (!started.ok) throw new Error(job.error ?? "The edit did not start");
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
      setPhase({ kind: "compose", error: "The project could not be opened" });
    }
  };

  const job = phase.kind === "compose" ? null : phase.job;
  const status = phase.kind === "job" ? phase.job.status : null;

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <span className={styles.brand}>
          <Mark />
          Video editor
        </span>
        {keySet !== null && (
          <button type="button" className={styles.keyButton} onClick={() => setAsking("anthropic")}>
            {keySet ? (
              <>
                <CheckIcon width={14} height={14} />
                API key saved · Replace
              </>
            ) : (
              "Add your API key"
            )}
          </button>
        )}
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

      {phase.kind === "compose" || phase.kind === "uploading" ? (
        <main className={styles.layout}>
          <div className={styles.main}>
            <div className={styles.hero}>
              <h1 className={styles.title}>Drop in footage. Get back a finished video.</h1>
              <p className={styles.lede}>
                Cut to the length you choose, with the best takes kept, fillers and dead air
                removed, and captions to go with it.
              </p>
            </div>
            {setup && setup.state !== "ready" && (
              <SetupView setup={setup} onRetry={() => void retrySetup().then(setSetup)} />
            )}
            <Footage
              items={items}
              skipped={skipped}
              onAdd={add}
              onRemove={(key) => setItems((current) => current.filter((item) => item.key !== key))}
              onToggle={(key) =>
                setItems((current) =>
                  current.map((item) => (item.key === key ? { ...item, off: !item.off } : item)),
                )
              }
              onClear={() => {
                setItems([]);
                setSkipped(0);
              }}
            />
            {phase.kind === "compose" && <Projects onOpen={(id) => void open(id)} />}
          </div>

          <aside className={`${styles.card} ${styles.panel}`} aria-label="Settings">
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
            />
            {phase.kind === "compose" && phase.error && (
              <p className={styles.error} role="alert">
                <AlertIcon width={16} height={16} />
                {phase.error}
              </p>
            )}
            {phase.kind === "uploading" ? (
              <div className={styles.uploading}>
                <div className={styles.uploadHead}>
                  <span>
                    Sending footage · file {phase.file + 1} of {used.length}
                  </span>
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
                  {formatBytes(phase.sent)} of {formatBytes(phase.total)}
                </p>
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => void cancel(phase.job)}
                >
                  Cancel
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
                  {"seconds" in length
                    ? `Make the ${formatLength(length.seconds)} video`
                    : "Make the video"}
                </button>
                {blocked ? (
                  <p className={styles.help}>{blocked}</p>
                ) : keySet === false ? (
                  <p className={styles.help}>Add your Anthropic API key to start</p>
                ) : choices.asr === "cloud" && keys?.openrouter === false ? (
                  <p className={styles.help}>Add your OpenRouter API key to start</p>
                ) : (
                  estimate && (
                    <p className={styles.help}>
                      Claude will cost about {formatDollars(estimate.low)} to{" "}
                      {formatDollars(estimate.high)} for this edit
                    </p>
                  )
                )}
              </div>
            )}
            <p className={styles.note}>
              <LockIcon width={14} height={14} />
              <span>
                {choices.asr === "cloud"
                  ? "Footage stays on this computer. OpenRouter hears the speech audio; Claude reads the transcripts and stills around each cut. No video file is uploaded."
                  : "Footage stays on the server that runs this page. Claude reads the transcripts and stills around each cut; no video or audio file is uploaded."}
              </span>
            </p>
          </aside>
        </main>
      ) : (
        <main className={styles.layout}>
          <div className={styles.main}>
            {status === "done" && job ? <Player job={job} /> : job && <RunView job={job} />}
          </div>
          <aside className={`${styles.card} ${styles.panel}`} aria-label="The edit">
            {status === "running" && job && <Running job={job} onCancel={() => cancel(job)} />}
            {status === "done" && job && (
              <Done job={job} onNew={() => setPhase({ kind: "compose" })} />
            )}
            {(status === "error" || status === "cancelled") && job && (
              <Failed
                job={job}
                onBack={() => setPhase({ kind: "compose" })}
                onReplaceKey={(service) => setAsking(service)}
              />
            )}
          </aside>
        </main>
      )}
    </div>
  );
}

function Running({ job, onCancel }: { job: Job; onCancel: () => void }) {
  const [sure, setSure] = useState(false);
  useEffect(() => {
    if (!sure) return;
    const timer = setTimeout(() => setSure(false), 4000);
    return () => clearTimeout(timer);
  }, [sure]);
  return (
    <>
      <Summary job={job} />
      <button
        type="button"
        className={sure ? `${styles.button} ${styles.danger}` : styles.button}
        onClick={() => (sure ? onCancel() : setSure(true))}
      >
        {sure ? "Stop the edit? Click again" : "Cancel"}
      </button>
      <p className={styles.help}>
        You can close this page: the edit keeps going, and the page shows it again when you come
        back.
      </p>
    </>
  );
}

function Done({ job, onNew }: { job: Job; onNew: () => void }) {
  const base = `/api/jobs/${job.id}`;
  return (
    <>
      <div>
        <h2 className={styles.panelTitle}>Your edit is ready</h2>
        <ResultSummary job={job} />
      </div>
      <div className={styles.downloads}>
        <a className={styles.primary} href={`${base}/video?download`} download>
          <DownloadIcon width={18} height={18} />
          Download MP4
        </a>
        {job.result?.captions && (
          <a className={styles.button} href={`${base}/captions?download`} download>
            <CaptionsIcon width={18} height={18} />
            Download captions (SRT)
          </a>
        )}
        {job.result?.broll && (
          <a className={styles.button} href={`${base}/broll?download`} download>
            <DownloadIcon width={18} height={18} />
            Download B-roll credits (TXT)
          </a>
        )}
      </div>
      <Summary job={job} />
      <button type="button" className={styles.linkButton} onClick={onNew}>
        Make another edit
      </button>
    </>
  );
}

function Failed({
  job,
  onBack,
  onReplaceKey,
}: {
  job: Job;
  onBack: () => void;
  onReplaceKey: (service: "anthropic" | "openrouter") => void;
}) {
  const cancelled = job.status === "cancelled";
  const fix = !cancelled && job.error ? fixFor(job.error) : null;
  const spent = job.claude ? total(job.claude) : null;
  return (
    <>
      <div>
        <h2 className={styles.panelTitle}>
          {cancelled ? "The edit was cancelled" : "The edit could not be finished"}
        </h2>
      </div>
      {!cancelled && (
        <p className={styles.error} role="alert">
          <AlertIcon width={16} height={16} />
          {job.error ?? "Something went wrong"}
        </p>
      )}
      {fix && <p className={styles.fix}>{fix.text}</p>}
      {spent !== null && spent !== 0 && (
        <p className={styles.help}>Claude cost {formatDollars(spent)} before the edit stopped.</p>
      )}
      {fix?.kind === "key" && (
        <button type="button" className={styles.button} onClick={() => onReplaceKey("anthropic")}>
          Replace the API key
        </button>
      )}
      {fix?.kind === "openrouter" && (
        <button type="button" className={styles.button} onClick={() => onReplaceKey("openrouter")}>
          Replace the OpenRouter key
        </button>
      )}
      <button type="button" className={styles.primary} onClick={onBack}>
        Back to the footage
      </button>
    </>
  );
}

function Summary({ job }: { job: Job }) {
  const videos = job.files.filter((file) => file.use === "video").length;
  const photos = job.files.filter((file) => file.use === "image").length;
  const offered = job.files.filter((file) => file.use === "music").length;
  const rows: [string, string][] = [
    ["Length", formatLength(job.settings.length)],
    ["Aspect", job.settings.aspect],
    ["Style", styleName(job.settings.style)],
    ["Speech", job.settings.asr === "cloud" ? "OpenRouter" : "On this computer"],
    // Edits from before the setting had none.
    ...(job.settings.visuals
      ? [["Visuals", job.settings.visuals === "rich" ? "Rich" : "Minimal"] as [string, string]]
      : []),
    [
      "Footage",
      `${videos} ${videos === 1 ? "video" : "videos"}${photos ? `, ${photos} ${photos === 1 ? "photo" : "photos"}` : ""}`,
    ],
  ];
  if (offered > 0) {
    // Claude picks one of the tracks offered, or none; the page knows which once it is done.
    const played = job.result?.music;
    rows.push([
      "Music",
      played
        ? played.length > 0
          ? played.map((path) => path.split("/").at(-1)).join(", ")
          : "None chosen"
        : `${offered} ${offered === 1 ? "track" : "tracks"} offered`,
    ]);
  }
  if (job.settings.names.length > 0) {
    // Edits from before terms had their own list counted both here.
    rows.push([
      job.settings.terms ? "Names" : "Names and terms",
      String(job.settings.names.length),
    ]);
  }
  if (job.settings.terms?.length) rows.push(["Terms", String(job.settings.terms.length)]);
  if (job.claude) {
    rows.push(["Claude, planning", formatDollars(job.claude.plan.dollars)]);
    rows.push(["Claude, checking cuts", formatDollars(job.claude.check.dollars)]);
  }
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
  return (
    <section className={`${styles.card} ${styles.setup}`} aria-label="Setting up the analysis">
      <div>
        <h2 className={styles.panelTitle}>
          {setup.state === "failed"
            ? "The analysis could not be set up"
            : "Setting up the analysis"}
        </h2>
        <p className={styles.help}>
          Only the first time: Python and the packages that analyse footage download and install on
          this computer. Add your keys and footage meanwhile.
        </p>
      </div>
      {setup.state === "failed" ? (
        <>
          <p className={styles.error} role="alert">
            <AlertIcon width={16} height={16} />
            {setup.error}
          </p>
          <button type="button" className={styles.button} onClick={onRetry}>
            Try again
          </button>
        </>
      ) : setup.download ? (
        <DownloadView download={setup.download} />
      ) : (
        <p className={styles.help}>Starting…</p>
      )}
    </section>
  );
}

async function retrySetup(): Promise<Setup> {
  const response = await fetch("/api/setup", { method: "POST" });
  return (await response.json()) as Setup;
}

/** What Claude cost in all; null when a price is unknown. */
function total(cost: NonNullable<Job["claude"]>): number | null {
  const { plan, check } = cost;
  return plan.dollars === null || check.dollars === null ? null : plan.dollars + check.dollars;
}

/** Sends a file as a request body, reporting the bytes sent; fetch cannot report them. */
function put(
  url: string,
  file: File,
  current: { current: XMLHttpRequest | null },
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
        reject(new Error(error ?? `${file.name} could not be sent (HTTP ${request.status})`));
      }
    };
    request.onerror = () => {
      current.current = null;
      reject(new Error(`${file.name} could not be sent`));
    };
    request.onabort = () => {
      current.current = null;
      reject(Object.assign(new Error("Cancelled"), { name: "AbortError" }));
    };
    request.send(file);
  });
}
