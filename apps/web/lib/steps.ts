// The analysis's checklist on the progress page: each step done, running or still to come.

import type { Job } from "./jobs.ts";

type Step = NonNullable<NonNullable<Job["progress"]>["step"]>;

/** The analysis's steps for one file, in the order vework takes them. */
const STEPS: Exclude<Step, "music">[] = [
  "probe",
  "shots",
  "speech",
  "loudness",
  "events",
  "faces",
  "denoise",
  "transcribe",
  "correct",
  "align",
];

type StepState = "active" | "done" | "failed" | "pending";

export interface ChecklistStep {
  /** Getting ready (checking Claude, first-use downloads such as FFmpeg), the music's analysis,
   * then the footage's steps. */
  step: "ready" | Step;
  state: StepState;
  /** How far a long step is: chunks done, or a percentage. */
  count?: string;
}

/**
 * The analysis's checklist: getting ready, the music's analysis when the edit has music, then the
 * steps for the file it is on, each done, running or still to come. A line before any file is
 * getting ready; one about a file with no step, such as a file analysed before, comes after the
 * music. A step vework had nothing to do for, such as faces in a file without picture, counts as
 * done once it is passed.
 */
export function analysisSteps(job: Job): ChecklistStep[] {
  const running = job.status === "running";
  const progress = job.progress;
  const analysing = progress?.stage === "analyze";
  const passed = progress !== undefined && !analysing;
  const failed = job.status === "error" && (analysing || progress === undefined);
  const music = job.files.some((file) => file.use === "music");
  const shown: ChecklistStep["step"][] = [
    "ready",
    ...(music ? ["music" as const] : []),
    ...STEPS.filter((step) => step !== "correct" || job.settings.correct),
  ];
  const order: ChecklistStep["step"][] = ["ready", "music", ...STEPS];
  // Where the line is in `order`: getting ready before the edit's first line (while a link
  // downloads, say) and for a line about no file; half a place past the music for a file with no
  // step.
  const at = !progress
    ? 0
    : !analysing
      ? -1
      : progress.step
        ? order.indexOf(progress.step)
        : progress.file
          ? order.indexOf("music") + 0.5
          : 0;
  return shown.map((step) => {
    const index = order.indexOf(step);
    const state: StepState =
      passed || (at >= 0 && index < at)
        ? "done"
        : index === at
          ? failed
            ? "failed"
            : running
              ? "active"
              : "pending"
          : "pending";
    const count =
      state === "active" && (step === "shots" || step === "transcribe" || step === "align")
        ? progress?.message.match(/(\d+\/\d+|\d+%)/)?.[1]
        : undefined;
    return { step, state, ...(count ? { count } : {}) };
  });
}
