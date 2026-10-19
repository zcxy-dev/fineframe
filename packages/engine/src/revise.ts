// Changing a finished edit without planning again, as the web page's re-edit panel does: each
// change is a recipe of skills/video-editor/references/recipes.md, and cuts go through cutEdit
// as `pnpm render --cut --retarget` takes them.

import { type CaptionLine, type Project, ticksPerFrame } from "@video-editor/schema";
import { cutEdit } from "./cut.ts";

export { placeSources } from "./cut.ts";

import { isLookId, type LookId } from "./looks.ts";
import type { PlaceSource } from "./plan/place.ts";
import { joinWords } from "./plan/text.ts";

/** The caption presets, by `captions.preset`; captions/presets.ts draws them. */
export const CAPTION_PRESETS = ["bold", "spotlight", "sweep", "boxed"] as const;
export type CaptionPreset = (typeof CAPTION_PRESETS)[number];

/** The text params of the overlays the panel retitles, with their longest length, as the effect
 * templates' catalog caps them. */
export const OVERLAY_TEXT = {
  title: { text: 24, subtitle: 40 },
  "lower-third": { name: 16, role: 28 },
} as const;

/** Something seen over the speaker that can go on its own: an effect overlay, a graphic, or
 * B-roll that is not the speaker beside a split screen. */
export interface Removal {
  kind: "overlay" | "graphic" | "broll";
  index: number;
}

export interface Revision {
  /** Stretches to take out, as [from, to) output ticks of the edit revised. */
  cuts?: [number, number][];
  /** New text for a caption word, by its line and its place in the line's words. */
  words?: { line: number; word: number; text: string }[];
  /** New text params for a title or lower third, by its index in `overlays`; an empty optional
   * one is left out. */
  overlays?: { index: number; params: Record<string, string> }[];
  remove?: Removal[];
  /** Raises or lowers every music track by this many dB, or takes the music out. */
  music?: { gainDb: number } | "remove";
  look?: LookId | "none";
  captions?: CaptionPreset;
}

export interface RevisionResult {
  project: Project;
  /** The revised edit's length, in ticks. */
  length: number;
  /** The stretches of the edit revised that no longer play, in its output ticks: where each cut
   * landed. */
  removed: [number, number][];
  /** What the cuts took out, for a person to check. */
  notes: string[];
  /** The words a cut took beyond those asked for, by its index in `cuts`, where no pause a cut
   * fits in lay inside its stretch. */
  outside: { range: number; words: string }[];
}

/** The output of `project` with `revision` applied. Every index in it is into `project` as
 * given; a cut makes the edit's length the one it is planned for, as --retarget does. Throws on a
 * change the project cannot take, naming it. */
export function revise(
  project: Project,
  revision: Revision,
  sources: ReadonlyMap<string, PlaceSource>,
): RevisionResult {
  let out: Project = structuredClone(project);
  if (revision.captions !== undefined) {
    if (!CAPTION_PRESETS.includes(revision.captions)) {
      throw new Error(`No caption style ${JSON.stringify(revision.captions)}`);
    }
    if (!out.captions) throw new Error("This edit has no captions to restyle");
    out.captions.preset = revision.captions;
  }
  for (const fix of revision.words ?? []) {
    const lines = out.captions?.lines ?? [];
    const line = lines[fix.line];
    if (!line?.words?.[fix.word]) throw new Error(`No caption word ${fix.line}:${fix.word}`);
    lines[fix.line] = fixWord(line, fix.word, fix.text);
  }
  for (const change of revision.overlays ?? []) {
    const overlay = out.overlays?.[change.index];
    const limits =
      overlay && (OVERLAY_TEXT as Record<string, Record<string, number>>)[overlay.template];
    if (!overlay || !limits)
      throw new Error(`/overlays/${change.index} is not a title or lower third`);
    const required = overlay.template === "title" ? "text" : "name";
    for (const [name, value] of Object.entries(change.params)) {
      const limit = limits[name];
      const text = value.trim();
      if (limit === undefined) throw new Error(`A ${overlay.template} has no ${name}`);
      if (text.length > limit) {
        throw new Error(`The ${overlay.template}'s ${name} takes at most ${limit} characters`);
      }
      if (text) overlay.params[name] = text;
      else if (name === required) throw new Error(`The ${overlay.template} needs its ${name}`);
      else delete overlay.params[name];
    }
  }
  if (revision.music === "remove") delete out.audio.music;
  else if (revision.music && out.audio.music) {
    const { gainDb } = revision.music;
    if (!Number.isFinite(gainDb)) throw new Error("The music's level is not a number");
    for (const track of out.audio.music) track.gainDb = (track.gainDb ?? 0) + gainDb;
  }
  if (revision.look !== undefined) {
    const look = revision.look;
    if (look !== "none" && !isLookId(look)) throw new Error(`No look ${JSON.stringify(look)}`);
    for (const clip of [...out.main, ...(out.broll ?? []).filter((each) => each.grade)]) {
      const intensity = clip.grade?.look?.intensity ?? 1;
      const { look: _, ...grade } = clip.grade ?? {};
      clip.grade = look === "none" ? grade : { ...grade, look: { id: look, intensity } };
      if (Object.keys(clip.grade).length === 0) delete clip.grade;
    }
  }
  if (revision.remove?.length) out = removeAll(out, revision.remove);
  if (!revision.cuts?.length) {
    return { project: out, length: editLength(out), removed: [], notes: [], outside: [] };
  }
  const cut = cutEdit(out, revision.cuts, sources);
  cut.project.output = {
    ...cut.project.output,
    target: { ...cut.project.output.target, duration: cut.length },
  };
  // Only what a cut asked for: a clip split by a cut also loses the part of a frame its new
  // start leaves over at its far end, beside a cut the edit already had.
  const cuts = revision.cuts;
  const removed = cut.removed.filter(([a, b]) => cuts.some(([x, y]) => a < y && b > x));
  return {
    project: cut.project,
    length: cut.length,
    removed,
    notes: cut.notes,
    outside: cut.outside,
  };
}

/** What `removeAll` can take out, with a line for a person to tell each apart. */
export interface Removable extends Removal {
  label: string;
  /** Output ticks. */
  start: number;
  duration: number;
}

const TEMPLATE_NAMES: Record<string, [string, string?]> = {
  title: ["Title", "text"],
  "lower-third": ["Lower third", "name"],
  keyword: ["Keyword", "text"],
  chapter: ["Chapter", "title"],
  callout: ["Callout", "label"],
  wipe: ["Wipe"],
};

/** Everything seen over the speaker that can go on its own, in time order. */
export function removables(project: Project): Removable[] {
  const items: Removable[] = [];
  for (const [index, overlay] of (project.overlays ?? []).entries()) {
    const [name, param] = TEMPLATE_NAMES[overlay.template] ?? [overlay.template];
    const text = param ? overlay.params[param] : undefined;
    items.push({
      kind: "overlay",
      index,
      label: typeof text === "string" ? `${name}: ${text}` : name,
      start: overlay.start,
      duration: overlay.duration,
    });
  }
  for (const [index, graphic] of (project.graphics ?? []).entries()) {
    const text = graphicText(graphic.html);
    items.push({
      kind: "graphic",
      index,
      label: `Graphic (${graphic.layout})${text ? `: ${text}` : ""}`,
      start: graphic.start,
      duration: graphic.duration,
    });
  }
  for (const [index, clip] of (project.broll ?? []).entries()) {
    if (!isVisual(project, index)) continue;
    const source = project.sources.find((each) => each.id === clip.source);
    const name = source?.credit?.what ?? source?.path.split(/[\\/]/).at(-1) ?? clip.source;
    items.push({
      kind: "broll",
      index,
      label: `B-roll: ${name}`,
      start: clip.start,
      duration: clip.out - clip.in,
    });
  }
  return items.sort((a, b) => a.start - b.start);
}

/** The ids of the sources the main track plays: B-roll of one is the speaker beside a split. */
function speakerSources(project: Project): Set<string> {
  return new Set(project.main.map((clip) => clip.source));
}

/** Whether `b` is B-roll a person sees as such, rather than the speaker beside a split. */
export function isVisual(project: Project, index: number): boolean {
  const clip = project.broll?.[index];
  return clip !== undefined && !speakerSources(project).has(clip.source);
}

/** The words a graphic's markup shows, without its tags, on one line. */
function graphicText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** `project` without what `removals` name, and what goes with each: a panel graphic's or a split's
 * speaker beside it and the sound effect at its start, and a chapter's wipe, the chapters left
 * renumbered. */
function removeAll(project: Project, removals: readonly Removal[]): Project {
  const frame = ticksPerFrame(project.output.fps);
  const overlays = new Set<number>();
  const graphics = new Set<number>();
  const broll = new Set<number>();
  const sfx = new Set<number>();
  const speakers = speakerSources(project);
  // The speaker beside a split screen over [start, end), and the sound effect at its start.
  const withSplit = (start: number, end: number, split: boolean) => {
    for (const [i, clip] of (project.broll ?? []).entries()) {
      if (split && speakers.has(clip.source) && clip.start >= start && clip.start < end) {
        broll.add(i);
      }
    }
    for (const [i, effect] of (project.audio.sfx ?? []).entries()) {
      if (Math.abs(effect.start - start) <= frame) sfx.add(i);
    }
  };
  for (const { kind, index } of removals) {
    if (kind === "overlay") {
      const overlay = project.overlays?.[index];
      if (!overlay) throw new Error(`No overlay /overlays/${index}`);
      overlays.add(index);
      if (overlay.template === "chapter") {
        // The wipe over the cut just before the chapter ends shortly after it starts.
        const wipe = (project.overlays ?? []).findIndex(
          (other) =>
            other.template === "wipe" &&
            other.start < overlay.start &&
            other.start + other.duration >= overlay.start,
        );
        if (wipe >= 0) overlays.add(wipe);
      }
    } else if (kind === "graphic") {
      const graphic = project.graphics?.[index];
      if (!graphic) throw new Error(`No graphic /graphics/${index}`);
      graphics.add(index);
      withSplit(graphic.start, graphic.start + graphic.duration, graphic.layout === "panel");
    } else {
      const clip = project.broll?.[index];
      if (!clip || !isVisual(project, index)) throw new Error(`No B-roll /broll/${index}`);
      broll.add(index);
      withSplit(clip.start, clip.start + clip.out - clip.in, clip.rect !== undefined);
    }
  }
  const out: Project = { ...project };
  if (project.overlays) {
    const left = project.overlays.filter((_, i) => !overlays.has(i));
    const chapters = left.filter((overlay) => overlay.template === "chapter");
    out.overlays = left.map((overlay) => {
      const at = chapters.indexOf(overlay);
      return at < 0
        ? overlay
        : { ...overlay, params: { ...overlay.params, index: at + 1, total: chapters.length } };
    });
  }
  if (project.graphics) out.graphics = project.graphics.filter((_, i) => !graphics.has(i));
  if (project.broll) out.broll = project.broll.filter((_, i) => !broll.has(i));
  if (project.audio.sfx) {
    out.audio = { ...project.audio, sfx: project.audio.sfx.filter((_, i) => !sfx.has(i)) };
  }
  return out;
}

/** A caption line with word `w` now saying `text`: the word's entry and its place in the line's
 * text change, every time stays. A text that no longer holds its words, as after a hand edit, is
 * rebuilt from them. */
export function fixWord(line: CaptionLine, w: number, text: string): CaptionLine {
  const words = line.words ?? [];
  const fixed = text.trim();
  if (!fixed || /[\r\n]/.test(fixed))
    throw new Error("A caption word needs some text, on one line");
  let cursor = 0;
  let at = -1;
  for (const [i, word] of words.entries()) {
    const found = line.text.indexOf(word.text, cursor);
    if (found < 0) {
      at = -1;
      break;
    }
    if (i === w) at = found;
    cursor = found + word.text.length;
  }
  const next = words.map((word, i) => (i === w ? { ...word, text: fixed } : word));
  const old = words[w]?.text ?? "";
  return {
    ...line,
    text:
      at < 0
        ? joinWords(next.map((word) => word.text))
        : line.text.slice(0, at) + fixed + line.text.slice(at + old.length),
    words: next,
  };
}

/** The edit's length in ticks: its main clips end to end, less the dissolves between them. */
export function editLength(project: Project): number {
  let length = 0;
  for (const [i, clip] of project.main.entries()) {
    length += clip.out - clip.in;
    if (i > 0 && clip.transition?.type === "dissolve") length -= clip.transition.duration;
  }
  return length;
}
