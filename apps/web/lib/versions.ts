// The versions of a finished edit: each Apply in the re-edit panel renders one more, beside the
// last, named as skills/video-editor names them (edit.mp4, then edit-v2.mp4, …).
import { join } from "node:path";
import type { Revision } from "@video-editor/engine/revise";
import { VIDEOS_KEPT } from "./retention.ts";

export interface Version {
  /** 1 for what the edit made, then one more for each Apply. */
  n: number;
  /** Epoch milliseconds. */
  created: number;
  /** What changed from the version it was made from, for a person. */
  summary: string;
  /** The version it was made from. */
  from?: number;
  /** Its length in seconds. */
  seconds?: number;
  /** The length and aspect it was planned for, when a re-plan changed them from the edit's. */
  length?: number;
  aspect?: "9:16" | "1:1" | "16:9";
  /** Whether its video is kept; a version without one renders again from its record. */
  video: boolean;
}

/** A version's files in the job's folder; its project.json is the record that renders it. */
export function versionFiles(n: number): {
  video: string;
  project: string;
  captions: string;
  broll: string;
} {
  const stem = join("out", n === 1 ? "edit" : `edit-v${n}`);
  return {
    video: `${stem}.mp4`,
    project: `${stem}.project.json`,
    captions: `${stem}.srt`,
    broll: `${stem}.broll.txt`,
  };
}

/** The versions whose videos go: all but the newest VIDEOS_KEPT and the one shown, which
 * plays. */
export function videosToPrune(versions: readonly Version[], shown: number): number[] {
  const newest = [...versions]
    .sort((a, b) => b.n - a.n)
    .slice(0, VIDEOS_KEPT)
    .map((version) => version.n);
  return versions
    .filter((version) => version.video && version.n !== shown && !newest.includes(version.n))
    .map((version) => version.n);
}

/** A revision as the page sends it, or what is wrong with it. The engine checks what each change
 * names; this checks only its shape. */
export function checkRevision(value: unknown): Revision | string {
  if (typeof value !== "object" || value === null) return "No changes";
  const revision = value as Revision;
  const integer = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0;
  if (
    revision.cuts !== undefined &&
    !(
      Array.isArray(revision.cuts) &&
      revision.cuts.every(
        (cut) => Array.isArray(cut) && cut.length === 2 && integer(cut[0]) && integer(cut[1]),
      )
    )
  ) {
    return "Each cut is a [from, to] pair of ticks";
  }
  if (
    revision.words !== undefined &&
    !(
      Array.isArray(revision.words) &&
      revision.words.every(
        (fix) => integer(fix?.line) && integer(fix?.word) && typeof fix?.text === "string",
      )
    )
  ) {
    return "Each caption fix names a line, a word and its text";
  }
  if (
    revision.overlays !== undefined &&
    !(
      Array.isArray(revision.overlays) &&
      revision.overlays.every(
        (change) =>
          integer(change?.index) &&
          typeof change?.params === "object" &&
          change.params !== null &&
          Object.values(change.params).every((text) => typeof text === "string"),
      )
    )
  ) {
    return "Each text change names an overlay and its new text";
  }
  if (
    revision.remove !== undefined &&
    !(
      Array.isArray(revision.remove) &&
      revision.remove.every(
        (removal) =>
          ["overlay", "card", "broll"].includes(removal?.kind) && integer(removal?.index),
      )
    )
  ) {
    return "Each removal names an overlay, a card or B-roll";
  }
  if (
    revision.music !== undefined &&
    revision.music !== "remove" &&
    typeof revision.music?.gainDb !== "number"
  ) {
    return "The music is removed or given a level";
  }
  if (revision.look !== undefined && typeof revision.look !== "string") return "No such look";
  if (revision.captions !== undefined && typeof revision.captions !== "string") {
    return "No such caption style";
  }
  const { cuts, words, overlays, remove, music, look, captions } = revision;
  return Object.fromEntries(
    Object.entries({ cuts, words, overlays, remove, music, look, captions }).filter(
      ([, change]) => change !== undefined,
    ),
  ) as Revision;
}
