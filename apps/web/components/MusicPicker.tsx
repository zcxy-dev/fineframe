"use client";

import { useEffect, useRef, useState } from "react";
import type { EditView } from "../lib/jobs.ts";
import { formatClock } from "../lib/settings.ts";
import styles from "./editor.module.css";
import { useT } from "./I18n.tsx";
import { PauseIcon, PlayIcon } from "./icons.tsx";

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

/** The music library in the re-edit panel: a mood at a time, each track with a preview, and the
 * one chosen to swap in. */
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
  const [playing, setPlaying] = useState<string | null>(null);
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

  const preview = (track: LibraryEntry) => {
    const player = audio.current;
    if (!player) return;
    if (playing === track.id) {
      player.pause();
      setPlaying(null);
      return;
    }
    player.src = `/api/music/${encodeURIComponent(track.id)}`;
    void player.play().catch(() => setPlaying(null));
    setPlaying(track.id);
  };

  return (
    <div className={styles.library}>
      <span className={styles.label}>{words.title}</span>
      {/* biome-ignore lint/a11y/useMediaCaption: a music preview has no words to caption. */}
      <audio ref={audio} onEnded={() => setPlaying(null)} onPause={() => setPlaying(null)} />
      <div className={styles.chips}>
        {MOODS.map((each) => (
          <button
            key={each}
            type="button"
            className={styles.chip}
            aria-pressed={each === shown}
            onClick={() => setMood(each)}
          >
            {words.moods[each]}
          </button>
        ))}
      </div>
      <ul className={styles.overlayList}>
        {tracks
          .filter((track) => track.mood === shown)
          .map((track) => {
            const using = chosen === undefined ? current?.track === track.id : chosen === track.id;
            return (
              <li key={track.id} className={styles.overlayItem} data-chosen={using}>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={
                    playing === track.id ? words.stop(track.title) : words.play(track.title)
                  }
                  onClick={() => preview(track)}
                >
                  {playing === track.id ? <PauseIcon /> : <PlayIcon />}
                </button>
                <span className={styles.overlayLabel}>
                  {track.title}
                  <span className={styles.trackMeta}>
                    {` · ${track.artist} · ${formatClock(track.seconds)}${track.bpm ? ` · ${Math.round(track.bpm)} BPM` : ""}`}
                  </span>
                </span>
                {using ? (
                  <span className={styles.trackMeta}>{words.using}</span>
                ) : (
                  <button
                    type="button"
                    className={styles.inlineButton}
                    onClick={() => onChoose(track.id === current?.track ? undefined : track)}
                  >
                    {words.use}
                  </button>
                )}
              </li>
            );
          })}
      </ul>
      <p className={styles.help}>{words.help}</p>
      <p className={styles.help}>{words.claim}</p>
    </div>
  );
}
