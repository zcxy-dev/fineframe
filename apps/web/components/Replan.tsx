"use client";

import { useState } from "react";
import type { Job } from "../lib/jobs.ts";
import { formatLength } from "../lib/settings.ts";
import styles from "./editor.module.css";
import { AlertIcon } from "./icons.tsx";

const LENGTHS = [15, 30, 60, 180, 600] as const;
const ASPECTS = ["9:16", "1:1", "16:9"] as const;

/** What a re-plan changes; one more field, such as what to tell Claude, goes here and in
 * Jobs.replan. */
export interface ReplanChoice {
  length: number;
  aspect: (typeof ASPECTS)[number];
  /** A track offered to the edit by its path, "auto" for Claude to choose again, or "none". */
  music: string;
}

/** Plans the edit again from the same footage, as a new version. */
export function Replan({
  job,
  onJob,
  onClose,
}: {
  job: Job;
  onJob: (job: Job) => void;
  onClose: () => void;
}) {
  const shown = job.versions?.find((version) => version.n === (job.current ?? 1));
  const tracks = job.files.filter((file) => file.use === "music").map((file) => file.path);
  const [choice, setChoice] = useState<ReplanChoice>({
    length: shown?.length ?? job.settings.length,
    aspect: shown?.aspect ?? job.settings.aspect,
    music: "auto",
  });
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setError(null);
    const response = await fetch(`/api/jobs/${job.id}/replan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(choice),
    });
    const body = (await response.json().catch(() => ({}))) as Job & { error?: string };
    if (!response.ok) setError(body.error ?? "The edit could not be planned again");
    else {
      onJob(body);
      onClose();
    }
  };
  return (
    <div className={styles.replan}>
      <p className={styles.help}>
        Claude plans the edit again from the same footage: it decides the story order and what to
        keep anew, so it may reorder, put back or leave out other parts than this version. The
        analysis is kept, so it takes a minute or two and one more plan. It becomes a new version;
        this one stays in the list.
      </p>
      <div className={styles.field}>
        <span className={styles.label}>Length</span>
        <div className={styles.chips}>
          {LENGTHS.map((seconds) => (
            <button
              key={seconds}
              type="button"
              className={styles.chip}
              aria-pressed={choice.length === seconds}
              onClick={() => setChoice({ ...choice, length: seconds })}
            >
              {formatLength(seconds)}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.field}>
        <span className={styles.label}>Aspect</span>
        <div className={styles.chips}>
          {ASPECTS.map((aspect) => (
            <button
              key={aspect}
              type="button"
              className={styles.chip}
              aria-pressed={choice.aspect === aspect}
              onClick={() => setChoice({ ...choice, aspect })}
            >
              {aspect}
            </button>
          ))}
        </div>
      </div>
      {tracks.length > 0 && (
        <label className={styles.field}>
          <span className={styles.label}>Music</span>
          <select
            className={styles.input}
            value={choice.music}
            onChange={(event) => setChoice({ ...choice, music: event.target.value })}
          >
            <option value="auto">Let Claude choose again</option>
            {tracks.map((path) => (
              <option key={path} value={path}>
                {path.split("/").at(-1)}
              </option>
            ))}
            <option value="none">No music</option>
          </select>
        </label>
      )}
      {error && (
        <p className={styles.error} role="alert">
          <AlertIcon width={16} height={16} />
          {error}
        </p>
      )}
      <div className={styles.toolbar}>
        <button type="button" className={styles.primary} onClick={() => void start()}>
          Re-plan as a new version
        </button>
        <button type="button" className={styles.linkButton} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
