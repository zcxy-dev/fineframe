"use client";

import { useState } from "react";
import type { Job, ReplanChoice } from "../lib/jobs.ts";
import { formatLength } from "../lib/settings.ts";
import styles from "./editor.module.css";
import { AlertIcon } from "./icons.tsx";

const LENGTHS = [15, 30, 60, 180, 600];
const ASPECTS = ["9:16", "1:1", "16:9"] as const;

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
  const planned = shown?.length ?? job.settings.length;
  // Each field is one entry of the choice, which Jobs.replan takes as it is.
  const [choice, setChoice] = useState<ReplanChoice>({
    length: planned,
    aspect: shown?.aspect ?? job.settings.aspect,
    music: "auto",
    instructions: "",
  });
  const lengths = LENGTHS.includes(planned) ? LENGTHS : [...LENGTHS, planned].sort((a, b) => a - b);
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
          {lengths.map((seconds) => (
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
      <label className={styles.field}>
        <span className={styles.label}>
          Tell Claude what to change <span className={styles.labelHint}>Optional</span>
        </span>
        <textarea
          className={styles.textarea}
          maxLength={2000}
          placeholder={"Open with the demo\nPut back the part about pricing\nEnd on the question"}
          value={choice.instructions}
          onChange={(event) => setChoice({ ...choice, instructions: event.target.value })}
        />
      </label>
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
