"use client";

import { estimateCost, estimateShortsCost } from "@video-editor/engine/estimate";
import {
  ArrowLeft,
  Captions,
  Download,
  FileText,
  KeyRound,
  LockKeyhole,
  SquareArrowOutUpRight,
  Stamp,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Picked } from "../lib/collect.ts";
import { durationOf } from "../lib/collect.ts";
import { fixFor } from "../lib/fixes.ts";
import type { Messages } from "../lib/i18n/messages.ts";
import type { Job } from "../lib/jobs.ts";
import type { Service } from "../lib/key.ts";
import type { Remembered } from "../lib/remembered.ts";
import { FOOTAGE_KEPT } from "../lib/retention.ts";
import {
  DEFAULT_CAPTIONS,
  DEFAULT_FILLERS,
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
import { cn, HELP, PANEL_TITLE, SECTION, TITLE } from "../lib/styles.ts";
import { dollarsOf, summaryRows } from "../lib/summary.ts";
import { AccountDialog, mayEdit, useAccount } from "./Account.tsx";
import { BrandKits, useKits } from "./BrandKits.tsx";
import { ErrorNote } from "./ErrorNote.tsx";
import { Footage, type Item, type LinkItem } from "./Footage.tsx";
import { useT } from "./I18n.tsx";
import { KeyDialog } from "./KeyDialog.tsx";
import { Language } from "./Language.tsx";
import { Projects } from "./Projects.tsx";
import { ReEdit, Versions } from "./ReEdit.tsx";
import { ResultSummary, useVideoLength } from "./ResultView.tsx";
import { Bar, DownloadView, RunView } from "./RunView.tsx";
import { type Choices, chosenLength, type Machine, SettingsPanel } from "./SettingsPanel.tsx";
import { ShortsDone, ShortsGrid, ShortsKept, ShortText } from "./Shorts.tsx";
import { UpdateNotice } from "./UpdateNotice.tsx";
import { Button } from "./ui/button.tsx";
import { Workspace } from "./Workspace.tsx";

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
    fillers: DEFAULT_FILLERS,
    quality: "best",
    correct: false,
    captions: DEFAULT_CAPTIONS,
    emoji: false,
    brand: null,
    instructions: "",
  });
  // The Brand kit page, over the rest while it shows.
  const [kitsOpen, setKitsOpen] = useState(false);
  const { list: kits, reload: reloadKits } = useKits();
  // The default kit until the owner chooses, its custom captions with it; a chosen kit deleted
  // since is none.
  const [brandChosen, setBrandChosen] = useState(false);
  useEffect(() => {
    if (!kits) return;
    setChoices((current) => {
      const kept = kits.kits.find((each) => each.id === current.brand) ?? null;
      const kit = brandChosen ? kept : (kits.kits.find((each) => each.id === kits.default) ?? null);
      const captions = kit?.brand.captions
        ? brandChosen
          ? current.captions
          : "brand"
        : current.captions === "brand"
          ? DEFAULT_CAPTIONS
          : current.captions;
      return { ...current, brand: kit?.id ?? null, captions };
    });
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
  // In the desktop app, the account a new edit needs; its dialog opens by itself the first time
  // it cannot edit.
  const { account, setAccount, reload: reloadAccount } = useAccount();
  const [accountOpen, setAccountOpen] = useState(false);
  useEffect(() => {
    void reloadAccount()
      .then((found) => {
        if (mayEdit(found) === false) setAccountOpen(true);
      })
      .catch(() => {});
  }, [reloadAccount]);

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
    if (mayEdit(account) === false) {
      setAccountOpen(true);
      return;
    }
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
            fillers: choices.fillers,
            quality: choices.quality,
            correct: choices.correct,
            captions: choices.captions,
            ...(choices.emoji ? { emoji: true } : {}),
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
        if (created.code === "account") {
          void reloadAccount().catch(() => {});
          setAccountOpen(true);
        }
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

  const done = status === "done" && job !== null;
  const failed = (status === "error" || status === "cancelled") && job !== null;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-1.5 border-b bg-card px-4 max-sm:px-2">
        <span className="group/brand mr-auto inline-flex items-center gap-2.5 text-[17px] font-bold tracking-[-0.02em]">
          <Image
            src="/icon.svg"
            width={26}
            height={26}
            alt=""
            loading="eager"
            className="transition-transform duration-500 ease-(--ease-cut) group-hover/brand:rotate-90 motion-reduce:group-hover/brand:rotate-0"
          />
          <span className="max-[479px]:sr-only">Fineframe</span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="aria-pressed:bg-accent aria-pressed:text-foreground"
          aria-pressed={kitsOpen}
          onClick={() => {
            if (kitsOpen) reloadKits();
            setKitsOpen(!kitsOpen);
          }}
        >
          <Stamp aria-hidden="true" />
          {t.kits.menu}
        </Button>
        <Language />
        {account?.gated && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setAccountOpen(true)}>
            {account.signedIn ? account.email : t.header.signIn}
          </Button>
        )}
        {keySet !== null &&
          (keySet ? (
            // Set: a quiet status, which opens the key to replace it.
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t.header.replaceKey}
              onClick={() => setAsking("anthropic")}
            >
              <span className="size-2 rounded-full bg-success" aria-hidden="true" />
              <span className="max-sm:hidden">{t.header.keySaved}</span>
              <span className="sm:hidden">{t.header.keyShort}</span>
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={() => setAsking("anthropic")}>
              <KeyRound aria-hidden="true" />
              {t.header.addKey}
            </Button>
          ))}
      </header>
      <AccountDialog
        account={account}
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        onChange={setAccount}
        reload={reloadAccount}
      />
      <UpdateNotice />
      <KeyDialog
        service={asking ?? "anthropic"}
        open={asking !== null && !accountOpen}
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
        <Workspace
          label={t.compose.settings}
          panel={
            <>
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
              <p className={cn(HELP, "flex gap-2 border-t px-6 py-5 max-md:px-4")}>
                <LockKeyhole className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span>
                  {choices.asr === "cloud" ? t.compose.privacyCloud : t.compose.privacyLocal}
                </span>
              </p>
            </>
          }
          foot={
            <>
              {phase.kind === "compose" && phase.error && (
                <ErrorNote message={phase.error} fallback={t.compose.startFallback} />
              )}
              {phase.kind === "uploading" ? (
                <div className="flex flex-col gap-2.5" aria-live="polite">
                  <div className="flex justify-between gap-3 text-[13px] font-medium">
                    <span>{t.compose.sending(phase.file + 1, used.length)}</span>
                    <span className="tabular-nums">
                      {Math.floor((phase.sent / Math.max(1, phase.total)) * 100)}%
                    </span>
                  </div>
                  <Bar fraction={phase.sent / Math.max(1, phase.total)} />
                  <div className="flex items-center gap-3">
                    <p className={cn(HELP, "flex-1 tabular-nums")}>
                      {t.compose.of(formatBytes(phase.sent), formatBytes(phase.total))}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void cancel(phase.job)}
                    >
                      {t.compose.cancel}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <Button
                    type="button"
                    size="lg"
                    className="w-full"
                    disabled={blocked !== null}
                    onClick={() => void start()}
                  >
                    {several
                      ? t.compose.makeShorts(choices.count)
                      : "seconds" in length
                        ? t.compose.make(formatLength(length.seconds, t))
                        : t.compose.makeVideo}
                  </Button>
                  <p className={cn(HELP, "text-center")}>
                    {blocked ??
                      (account?.gated && mayEdit(account) === false
                        ? account.signedIn
                          ? t.compose.needSubscription
                          : t.compose.needAccount
                        : keySet === false
                          ? t.compose.needAnthropic
                          : choices.asr === "cloud" && keys?.openrouter === false
                            ? t.compose.needOpenRouter
                            : estimate &&
                              (several ? t.compose.estimateShorts : t.compose.estimate)(
                                formatDollars(estimate.low, t),
                                formatDollars(estimate.high, t),
                              ))}
                  </p>
                </>
              )}
            </>
          }
        >
          <div className="flex flex-col gap-8 px-10 py-9 max-md:gap-6 max-md:px-4 max-md:py-6">
            <div className="flex flex-col gap-3">
              <h1 className={TITLE}>{t.compose.title}</h1>
              <p className="max-w-[64ch] text-[15px] leading-relaxed text-pretty text-steel">
                {t.compose.lede}
              </p>
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
        </Workspace>
      ) : one ? (
        <ReEdit
          job={one}
          onJob={update}
          video={video}
          // A short of a run stopped or cancelled before it ended does not change.
          editable={status === "done"}
          head={<DoneHead job={one} onBack={() => setOpened(null)} />}
          download={<DownloadButton job={one} />}
          result={
            <DoneFiles
              job={one}
              onJob={update}
              onNew={() => setPhase({ kind: "compose" })}
              onBack={() => setOpened(null)}
              fixed={status !== "done"}
            />
          }
        />
      ) : done && !job.settings.shorts ? (
        <ReEdit
          job={job}
          onJob={update}
          video={video}
          editable
          head={<DoneHead job={job} />}
          download={<DownloadButton job={job} />}
          result={
            <DoneFiles job={job} onJob={update} onNew={() => setPhase({ kind: "compose" })} />
          }
        />
      ) : (
        job && (
          <Workspace
            label={t.done.label}
            panelFirst={failed}
            panel={
              <>
                {status === "running" && <Running job={job} onCancel={() => cancel(job)} />}
                {done && (
                  <>
                    <ShortsDone job={job} />
                    <div className={cn(SECTION, "border-t")}>
                      <Summary job={job} />
                    </div>
                    <div className={cn(SECTION, "border-t")}>
                      <Button
                        type="button"
                        variant="link"
                        size="inline"
                        className="self-start"
                        onClick={() => setPhase({ kind: "compose" })}
                      >
                        {t.done.another}
                      </Button>
                    </div>
                  </>
                )}
                {failed && (
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
                {failed && job.shorts?.length ? <ShortsKept job={job} /> : null}
              </>
            }
          >
            {status !== "done" && <RunView job={job} />}
            {job.settings.shorts && (job.shorts?.length || status === "running") && (
              <ShortsGrid job={job} onOpen={setOpened} />
            )}
          </Workspace>
        )
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
      <div className={SECTION}>
        <Summary job={job} />
      </div>
      <div className={cn(SECTION, "border-t")}>
        <Button
          type="button"
          variant={sure ? "danger" : "outline"}
          onClick={() => (sure ? onCancel() : setSure(true))}
        >
          {sure ? t.run.sure : t.run.cancel}
        </Button>
        <p className={HELP}>{t.run.closeable}</p>
      </div>
    </>
  );
}

/** "Export to an editing app": has the server export the version shown, saying so while it
 * does, then downloads the zip. */
function ExportButton({ job }: { job: Job }) {
  const t = useT();
  const [state, setState] = useState<"idle" | "busy" | "done" | { error: string }>("idle");
  const run = async () => {
    setState("busy");
    try {
      const response = await fetch(jobApi(job, "export"), { method: "POST" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setState({ error: body.error ?? t.failed.wrong });
        return;
      }
      setState("done");
      const link = document.createElement("a");
      link.href = jobApi(job, "export");
      link.download = "";
      link.click();
    } catch {
      setState({ error: t.failed.wrong });
    }
  };
  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={run}
        disabled={state === "busy"}
        title={t.done.exportHelp}
      >
        <SquareArrowOutUpRight aria-hidden="true" />
        {state === "busy" ? t.done.exporting : t.done.exportApp}
      </Button>
      {typeof state === "object" && (
        <ErrorNote message={state.error} fallback={t.done.exportFallback} />
      )}
      {state === "done" && <p className={HELP}>{t.done.exported(FOOTAGE_KEPT)}</p>}
    </>
  );
}

/** A finished edit's heading in the editor's panel: its title, or
 * a short's with a way back to the others, and its length and aspect. */
function DoneHead({ job, onBack }: { job: Job; onBack?: () => void }) {
  const t = useT();
  const seconds = useVideoLength(job);
  const short = job.shorts?.find((each) => each.folder === job.short);
  return (
    <div className="flex flex-col items-start">
      {onBack && (
        <Button
          type="button"
          variant="link"
          size="inline"
          className="mb-2 text-xs"
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" />
          {t.shorts.back}
        </Button>
      )}
      <h2 className={PANEL_TITLE}>{short ? short.title : t.done.ready}</h2>
      <ResultSummary job={job} seconds={seconds} />
    </div>
  );
}

/** The edit's MP4, the one thing a finished edit is for. */
function DownloadButton({ job, className }: { job: Job; className?: string }) {
  const t = useT();
  return (
    <Button asChild size="lg" className={cn("w-full", className)}>
      <a href={jobApi(job, "video", { download: "" })} download>
        <Download aria-hidden="true" />
        {t.done.download}
      </a>
    </Button>
  );
}

/** The Result tab of a finished edit, or of one short of several with its title, description and
 * hashtags: the downloads, the versions, the details and a way on. */
function DoneFiles({
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
      <div className={SECTION}>
        {/* Where the panes stack, it is under the player instead. */}
        <DownloadButton job={job} className="max-lg:hidden" />
        {job.result?.captions && (
          <Button asChild variant="outline">
            <a href={jobApi(job, "captions", download)} download>
              <Captions aria-hidden="true" />
              {t.done.downloadCaptions}
            </a>
          </Button>
        )}
        {job.result?.broll && (
          <Button asChild variant="outline">
            <a href={jobApi(job, "broll", download)} download>
              <FileText aria-hidden="true" />
              {t.done.downloadCredits}
            </a>
          </Button>
        )}
        <ExportButton job={job} />
      </div>
      {short && (
        <div className={cn(SECTION, "border-t")}>
          <ShortText short={short} />
        </div>
      )}
      {fixed ? (
        <p className={cn(HELP, SECTION, "border-t")}>
          {t.shorts.unchangeable(job.status === "cancelled")}
        </p>
      ) : (
        (job.versions?.length ?? 0) > 1 && (
          <div className={cn(SECTION, "border-t")}>
            <Versions job={job} onJob={onJob} />
          </div>
        )
      )}
      <div className={cn(SECTION, "border-t")}>
        <Summary job={job} actual={seconds} />
      </div>
      <div className={cn(SECTION, "border-t")}>
        <Button
          type="button"
          variant="link"
          size="inline"
          className="self-start"
          onClick={onBack ?? onNew}
        >
          {onBack ? t.shorts.back : t.done.another}
        </Button>
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
    <div className={SECTION}>
      <h2 className={PANEL_TITLE}>{cancelled ? t.failed.cancelled : t.failed.title}</h2>
      {!cancelled && (
        <ErrorNote message={job.error ?? t.failed.wrong} fallback={t.failed.fallback} />
      )}
      {spent !== null && spent !== 0 && (
        <p className={HELP}>{t.failed.spent(formatDollars(spent, t))}</p>
      )}
      <div className="flex flex-col gap-2">
        {actions.map((action, i) => {
          const variant = i === 0 ? "default" : "outline";
          return "href" in action ? (
            <Button key={action.label} asChild variant={variant}>
              <a href={action.href} target="_blank" rel="noreferrer">
                {action.label}
              </a>
            </Button>
          ) : (
            <Button key={action.label} type="button" variant={variant} onClick={action.run}>
              {action.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

/** The edit's details as a spec sheet: name left, value right, hairline rows. */
function Summary({ job, actual }: { job: Job; actual?: number | null }) {
  const rows = summaryRows(job, actual, useT());
  return (
    <dl className="m-0 flex flex-col divide-y">
      {rows.map(([name, value]) => (
        <div key={name} className="flex items-baseline justify-between gap-3 py-2 text-[13px]">
          <dt className="text-muted-foreground">{name}</dt>
          <dd className="m-0 text-right font-medium tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The analysis's setup on the desktop app's first start: its download, or why it failed. */
function SetupView({ setup, onRetry }: { setup: Setup; onRetry: () => void }) {
  const t = useT();
  return (
    <section
      className="flex flex-col gap-3 rounded-2xl border bg-card p-5 animate-in fade-in-0 duration-300"
      aria-label={t.setup.title}
    >
      <div>
        <h2 className="text-[17px] font-bold tracking-[-0.01em]">
          {setup.state === "failed" ? t.setup.failed : t.setup.title}
        </h2>
        <p className={cn(HELP, "mt-1")}>{t.setup.about}</p>
      </div>
      {setup.state === "failed" ? (
        <ErrorNote message={setup.error ?? t.failed.wrong} fallback={t.setup.fallback}>
          <Button type="button" variant="outline" size="sm" className="mt-1.5" onClick={onRetry}>
            {t.setup.retry}
          </Button>
        </ErrorNote>
      ) : setup.download ? (
        <DownloadView download={setup.download} />
      ) : (
        <p className={HELP}>{t.setup.starting}</p>
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
