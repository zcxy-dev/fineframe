"use client";

import { LoaderCircle, Pause, Play, TriangleAlert } from "lucide-react";
import { useEffect, useReducer, useRef, useState } from "react";
import type { EditView } from "../lib/jobs.ts";
import { previewAfter } from "../lib/preview.ts";
import { formatClock } from "../lib/settings.ts";
import { cn, HELP, LABEL, LIST } from "../lib/styles.ts";
import { useT } from "./I18n.tsx";
import { Segments } from "./Segments.tsx";
import { Button } from "./ui/button.tsx";

/** A library track as /api/music lists it. */
export interface LibraryEntry {
  id: string;
  title: string;
  artist: string;
  mood: "calm" | "upbeat" | "emotional" | "corporate" | "energetic";
  seconds: number;
  bpm: number | null;
}

const MOODS = ["calm", "upbeat", "emotional", "corporate", "energetic"] as const;

/** The music library in the re-edit panel: a mood at a time, each track with a preview, which
 * shows it loads while the track downloads and says so when it cannot play, and the one chosen
 * to swap in. */
export function MusicPicker({
  current,
  chosen,
  onChoose,
}: {
  /** The music the version shown plays. */
  current: EditView["music"];
  /** The track the draft swaps in, by its id, or null when it takes the music out. */
  chosen: string | null | undefined;
  /** Swaps in a track, or undefined to keep the version's own. */
  onChoose: (track: LibraryEntry | undefined) => void;
}) {
  const t = useT();
  const words = t.reedit.library;
  const [tracks, setTracks] = useState<LibraryEntry[] | null>(null);
  const [mood, setMood] = useState<LibraryEntry["mood"] | null>(null);
  const [preview, dispatch] = useReducer(previewAfter, null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let live = true;
    void fetch("/api/music")
      .then((response) => (response.ok ? response.json() : []))
      .then((list: LibraryEntry[]) => live && setTracks(list))
      .catch(() => live && setTracks([]));
    return () => {
      live = false;
    };
  }, []);
  // Leaving the panel stops a preview.
  useEffect(() => () => audio.current?.pause(), []);

  if (!tracks || tracks.length === 0) return null;
  const own = tracks.find((track) => track.id === current?.track);
  const shown = mood ?? tracks.find((track) => track.id === chosen)?.mood ?? own?.mood ?? "calm";

  const toggle = (track: LibraryEntry) => {
    const player = audio.current;
    if (!player) return;
    const click = { type: "click", track: track.id } as const;
    dispatch(click);
    if (!previewAfter(preview, click)) {
      player.pause();
      return;
    }
    player.src = `/api/music/${encodeURIComponent(track.id)}`;
    // A play cut short by the next track's load is not a failure.
    void player.play().catch((error: Error) => {
      if (error.name !== "AbortError") dispatch({ type: "failed", track: track.id });
    });
  };

  return (
    <div className="flex flex-col gap-2.5">
      <span className={LABEL}>{words.title}</span>
      {/* biome-ignore lint/a11y/useMediaCaption: a music preview has no words to caption. */}
      <audio
        ref={audio}
        onPlaying={() => dispatch({ type: "playing" })}
        onEnded={() => dispatch({ type: "stopped" })}
        onPause={() => dispatch({ type: "stopped" })}
        onError={() => dispatch({ type: "failed" })}
      />
      <Segments
        className="flex-wrap"
        options={MOODS.map((each) => ({ value: each, label: words.moods[each] }))}
        value={shown}
        onChange={setMood}
      />
      <ul className={LIST}>
        {tracks
          .filter((track) => track.mood === shown)
          .map((track) => {
            const using = chosen === undefined ? current?.track === track.id : chosen === track.id;
            const state = preview?.track === track.id ? preview.state : null;
            const busy = state === "loading" || state === "playing";
            return (
              <li
                key={track.id}
                className={cn(
                  "grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-2.5 py-1.5 pr-3 pl-1.5 text-[13px] transition-colors hover:bg-accent",
                  using && "bg-raised",
                )}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn(busy && "bg-primary text-primary-foreground hover:bg-amber-hover")}
                  aria-label={busy ? words.stop(track.title) : words.play(track.title)}
                  aria-busy={state === "loading"}
                  onClick={() => toggle(track)}
                >
                  {state === "loading" ? (
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                  ) : state === "playing" ? (
                    <Pause aria-hidden="true" />
                  ) : (
                    <Play aria-hidden="true" />
                  )}
                </Button>
                <span className="flex min-w-0 flex-col">
                  <span className={cn("truncate", using && "font-semibold")}>{track.title}</span>
                  <span className="truncate text-xs text-muted-foreground tabular-nums">
                    {`${track.artist}${t.sep}${formatClock(track.seconds)}${track.bpm ? `${t.sep}${Math.round(track.bpm)} BPM` : ""}`}
                  </span>
                  {state === "failed" && (
                    <span className="flex items-center gap-1 text-xs text-foreground" role="alert">
                      <TriangleAlert
                        className="size-3 shrink-0 text-destructive"
                        aria-hidden="true"
                      />
                      {words.previewFailed}
                    </span>
                  )}
                </span>
                {using ? (
                  <span className="text-xs text-steel">{words.using}</span>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7"
                    onClick={() => onChoose(track.id === current?.track ? undefined : track)}
                  >
                    {words.use}
                  </Button>
                )}
              </li>
            );
          })}
      </ul>
      <p className={HELP}>{words.help}</p>
      <p className={HELP}>{words.claim}</p>
    </div>
  );
}
