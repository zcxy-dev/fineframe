"use client";

import { useState } from "react";
import type { Job, ReplanChoice } from "../lib/jobs.ts";
import { formatLength } from "../lib/settings.ts";
import { ErrorNote } from "./ErrorNote.tsx";
import styles from "./editor.module.css";
import { useT } from "./I18n.tsx";

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
  const t = useT();
  const words = t.replan;
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
  const [sending, setSending] = useState(false);
  const start = async () => {
    setError(null);
    setSending(true);
    const response = await fetch(`/api/jobs/${job.id}/replan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(choice),
    });
    const body = (await response.json().catch(() => ({}))) as Job & { error?: string };
    setSending(false);
    if (!response.ok) setError(body.error ?? words.notPlanned);
    else {
      onJob(body);
      onClose();
    }
  };
  return (
    <div className={styles.replan}>
      <p className={styles.help}>{words.help}</p>
      <div className={styles.field}>
        <span className={styles.label}>{words.length}</span>
        <div className={styles.chips}>
          {lengths.map((seconds) => (
            <button
              key={seconds}
              type="button"
              className={styles.chip}
              aria-pressed={choice.length === seconds}
              onClick={() => setChoice({ ...choice, length: seconds })}
            >
              {formatLength(seconds, t)}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.field}>
        <span className={styles.label}>{words.aspect}</span>
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
          <span className={styles.label}>{words.music}</span>
          <select
            className={styles.input}
            value={choice.music}
            onChange={(event) => setChoice({ ...choice, music: event.target.value })}
          >
            <option value="auto">{words.auto}</option>
            {tracks.map((path) => (
              <option key={path} value={path}>
                {path.split("/").at(-1)}
              </option>
            ))}
            <option value="none">{words.none}</option>
          </select>
        </label>
      )}
      <label className={styles.field}>
        <span className={styles.label}>
          {words.instructions} <span className={styles.labelHint}>{words.optional}</span>
        </span>
        <textarea
          className={styles.textarea}
          maxLength={2000}
          placeholder={words.placeholder}
          value={choice.instructions}
          onChange={(event) => setChoice({ ...choice, instructions: event.target.value })}
        />
      </label>
      {error && <ErrorNote message={error} fallback={words.fallback} />}
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.primary}
          disabled={sending}
          onClick={() => void start()}
        >
          {words.start}
        </button>
        <button type="button" className={styles.linkButton} onClick={onClose}>
          {words.cancel}
        </button>
      </div>
    </div>
  );
}
