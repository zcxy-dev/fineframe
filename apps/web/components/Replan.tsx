"use client";

import { useId, useState } from "react";
import type { Job, ReplanChoice } from "../lib/jobs.ts";
import { formatLength } from "../lib/settings.ts";
import { jobApi, REPLAN_MARGIN } from "../lib/shorts.ts";
import { HELP, LABEL, LABEL_HINT } from "../lib/styles.ts";
import { ErrorNote } from "./ErrorNote.tsx";
import { useT } from "./I18n.tsx";
import { Segments } from "./Segments.tsx";
import { Button } from "./ui/button.tsx";
import { NativeSelect, Textarea } from "./ui/input.tsx";

const LENGTHS = [15, 30, 60, 180, 600];
const ASPECTS = ["9:16", "1:1", "16:9"] as const;

/** Plans the edit again from the same footage, as a new version. */
export function Replan({ job, onJob }: { job: Job; onJob: (job: Job) => void }) {
  const t = useT();
  const words = t.replan;
  const id = useId();
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
    const response = await fetch(jobApi(job, "replan"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(choice),
    });
    const body = (await response.json().catch(() => ({}))) as Job & { error?: string };
    setSending(false);
    if (!response.ok) setError(body.error ?? words.notPlanned);
    else onJob(body);
  };
  return (
    <div className="flex flex-col gap-4">
      <p className={HELP}>
        {words.help}
        {job.short && ` ${words.stretch(REPLAN_MARGIN)}`}
      </p>
      <div className="flex flex-col gap-2.5">
        <span className={LABEL}>{words.length}</span>
        <Segments
          options={lengths.map((seconds) => ({ value: seconds, label: formatLength(seconds, t) }))}
          value={choice.length}
          onChange={(length) => setChoice({ ...choice, length })}
        />
      </div>
      <div className="flex flex-col gap-2.5">
        <span className={LABEL}>{words.aspect}</span>
        <Segments
          options={ASPECTS.map((aspect) => ({ value: aspect, label: aspect }))}
          value={choice.aspect}
          onChange={(aspect) => setChoice({ ...choice, aspect })}
        />
      </div>
      {tracks.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <label className={LABEL} htmlFor={`${id}-music`}>
            {words.music}
          </label>
          <NativeSelect
            id={`${id}-music`}
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
          </NativeSelect>
        </div>
      )}
      <div className="flex flex-col gap-2.5">
        <label className={LABEL} htmlFor={`${id}-instructions`}>
          {words.instructions} <span className={LABEL_HINT}>{words.optional}</span>
        </label>
        <Textarea
          id={`${id}-instructions`}
          maxLength={2000}
          placeholder={words.placeholder}
          value={choice.instructions}
          onChange={(event) => setChoice({ ...choice, instructions: event.target.value })}
        />
      </div>
      {error && <ErrorNote message={error} fallback={words.fallback} />}
      <Button type="button" className="self-start" disabled={sending} onClick={() => void start()}>
        {words.start}
      </Button>
    </div>
  );
}
