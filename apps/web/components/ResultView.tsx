"use client";

import { Maximize, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { type RefObject, useEffect, useState } from "react";
import type { Job } from "../lib/jobs.ts";
import { shownPlan } from "../lib/paths.ts";
import { formatClock } from "../lib/settings.ts";
import { jobApi } from "../lib/shorts.ts";
import { HELP } from "../lib/styles.ts";
import { useT } from "./I18n.tsx";
import { Button } from "./ui/button.tsx";

/** Each aspect's width over its height. */
const RATIO: Record<string, number> = { "9:16": 9 / 16, "1:1": 1, "16:9": 16 / 9 };

/** The finished video in the editor's viewer: as large as the stage allows, in viewfinder
 * corners, with the app's own controls under it. */
export function Player({ job, video }: { job: Job; video: RefObject<HTMLVideoElement | null> }) {
  const t = useT();
  const aspect = shownPlan(job).aspect;
  const ratio = RATIO[aspect] ?? 16 / 9;
  return (
    <section
      className="relative grid min-h-0 flex-1 place-items-center overflow-hidden bg-well p-8 [container-type:size] max-lg:h-[min(72vh,620px)] max-lg:flex-none max-md:p-5"
      aria-label={t.done.player}
    >
      <div
        className="flex flex-col gap-3 animate-in fade-in-0 zoom-in-[0.98] duration-700"
        style={{ width: `min(100cqw, calc((100cqh - ${CONTROLS}px) * ${ratio}))` }}
      >
        <div className="viewfinder relative [--inset:-12px]" style={{ aspectRatio: String(ratio) }}>
          {/* biome-ignore lint/a11y/useMediaCaption: the captions are burned into the picture. */}
          <video
            ref={video}
            // Focusable, so the arrow keys step it a frame.
            tabIndex={0}
            aria-label={t.done.player}
            className="block size-full rounded-xl bg-black shadow-[0_40px_80px_-36px_rgb(12_13_16/0.42),0_2px_8px_rgb(12_13_16/0.06)]"
            src={jobApi(job, "video", { v: job.current ?? 1 })}
            playsInline
            preload="metadata"
          />
        </div>
        <Controls video={video} />
      </div>
    </section>
  );
}

/** The controls' height and the gap over them, which the picture leaves room for. */
const CONTROLS = 52;

/** Play, the time, a scrubber, sound and full screen, in the app's own look. */
function Controls({ video }: { video: RefObject<HTMLVideoElement | null> }) {
  const words = useT().player;
  const [state, setState] = useState({ time: 0, length: 0, paused: true, muted: false });
  useEffect(() => {
    const player = video.current;
    if (!player) return;
    const read = () =>
      setState({
        time: player.currentTime,
        length: Number.isFinite(player.duration) ? player.duration : 0,
        paused: player.paused,
        muted: player.muted,
      });
    const events = ["timeupdate", "durationchange", "play", "pause", "volumechange", "seeked"];
    for (const name of events) player.addEventListener(name, read);
    read();
    return () => {
      for (const name of events) player.removeEventListener(name, read);
    };
  }, [video]);
  const player = () => video.current;
  return (
    // As wide as the picture, and wide enough to scrub a vertical one.
    <div className="flex h-10 w-[max(100%,min(360px,100cqw))] items-center gap-1.5 self-center rounded-full border bg-card px-1.5 shadow-[0_2px_8px_rgb(12_13_16/0.06)]">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={state.paused ? words.play : words.pause}
        onClick={() => {
          const each = player();
          if (!each) return;
          if (each.paused) void each.play();
          else each.pause();
        }}
      >
        {state.paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
      </Button>
      <span className="shrink-0 px-1 text-xs text-steel tabular-nums">
        {formatClock(state.time)} / {formatClock(state.length)}
      </span>
      <input
        type="range"
        className="min-w-0 flex-1"
        aria-label={words.seek}
        min={0}
        max={state.length || 1}
        step={0.01}
        value={state.time}
        onChange={(event) => {
          const each = player();
          if (each) each.currentTime = Number(event.target.value);
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={state.muted ? words.unmute : words.mute}
        onClick={() => {
          const each = player();
          if (each) each.muted = !each.muted;
        }}
      >
        {state.muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={words.fullScreen}
        onClick={() => void player()?.requestFullscreen()}
      >
        <Maximize aria-hidden="true" />
      </Button>
    </div>
  );
}

/** The video's length, read from its header; null until it is. */
export function useVideoLength(job: Job): number | null {
  const [seconds, setSeconds] = useState<number | null>(null);
  const version = job.current ?? 1;
  const src = jobApi(job, "video", { v: version });
  useEffect(() => {
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => setSeconds(probe.duration);
    probe.src = src;
    return () => {
      probe.onloadedmetadata = null;
      probe.removeAttribute("src");
      probe.load();
    };
  }, [src]);
  return seconds;
}

export function ResultSummary({ job, seconds }: { job: Job; seconds: number | null }) {
  const t = useT();
  return (
    <>
      <p className="mt-1 text-[13px] text-steel tabular-nums">
        {seconds ? formatClock(seconds) : "…"}
        {t.sep}
        {shownPlan(job).aspect}
        {job.result?.captions ? t.done.captions : ""}
      </p>
      {/* Only the first version went without; a later one may have music from the panel. */}
      {job.result?.musicSkipped && (job.current ?? 1) === 1 && (
        <p className={`mt-2 ${HELP}`}>{t.done.musicSkipped}</p>
      )}
      {job.result?.beatsSkipped && (job.current ?? 1) === 1 && (
        <p className={`mt-2 ${HELP}`}>{t.done.beatsSkipped}</p>
      )}
    </>
  );
}
