import { readFile } from "node:fs/promises";
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import mediaIndexSchema from "../media-index.schema.json" with { type: "json" };
import musicIndexSchema from "../music-index.schema.json" with { type: "json" };
import progressSchema from "../progress.schema.json" with { type: "json" };
import projectSchema from "../project.schema.json" with { type: "json" };
import shortsSchema from "../shorts.schema.json" with { type: "json" };
import type { MediaIndex } from "./generated/media-index.ts";
import type { MusicIndex } from "./generated/music-index.ts";
import type { Progress } from "./generated/progress.ts";
import type {
  Brand,
  Clip,
  CropKeyframe,
  CropRect,
  Project,
  Rect,
  Source,
} from "./generated/project.ts";
import type { Shorts } from "./generated/shorts.ts";
import { ticksPerFrame } from "./time.ts";
import { upgradeProject } from "./upgrade.ts";

/** A value that does not match its schema; the message lists every problem, one per line. */
export class SchemaError extends Error {
  override name = "SchemaError";
}

const ajv = new Ajv2020({ allErrors: true });

function validator<T>(schema: object, problems: (value: T) => string[] = () => []) {
  const validate = ajv.compile<T>(schema);
  return (value: unknown): T => {
    if (!validate(value)) throw new SchemaError(describeErrors(validate.errors ?? []));
    const found = problems(value);
    if (found.length > 0) throw new SchemaError(found.join("\n"));
    return value;
  };
}

/** Ajv's errors as lines of `<JSON Pointer>: <problem>`, each pointer under `at`. */
export function describeErrors(errors: ErrorObject[], at = ""): string {
  const lines = errors.map((error) => {
    const extra =
      error.keyword === "additionalProperties" ? ` (${error.params.additionalProperty})` : "";
    return `${at}${error.instancePath || (at ? "" : "/")}: ${error.message}${extra}`;
  });
  return [...new Set(lines)].join("\n");
}

export const validateMediaIndex = validator<MediaIndex>(mediaIndexSchema);
export const validateMusicIndex = validator<MusicIndex>(musicIndexSchema);
export const validateProgress = validator<Progress>(progressSchema);
/** Also checks that the range and each stretch run forward and that folders are not shared. */
export const validateShorts = validator<Shorts>(shortsSchema, (shorts) => {
  const problems: string[] = [];
  const [shortest, longest] = shorts.range;
  if (shortest >= longest) problems.push("/range: the shortest is under the longest");
  const folders = new Set<string>();
  for (const [i, short] of shorts.shorts.entries()) {
    if (short.start >= short.end) problems.push(`/shorts/${i}: its stretch runs forward`);
    if (folders.has(short.folder)) problems.push(`/shorts/${i}/folder: ${short.folder} twice`);
    folders.add(short.folder);
  }
  return problems;
});
/** A brand kit, as a kit folder's kit.json holds it and project.json's `brand`. */
export const validateBrand = validator<Brand>({
  $ref: "#/$defs/Brand",
  $defs: projectSchema.$defs,
});
const validateCurrent = validator<Project>(projectSchema, projectProblems);
/** Also runs the checks a schema cannot express, which packages/schema/README.md lists. A project
 * an earlier version wrote is read as this version would have written it (`upgradeProject`). */
export const validateProject = (value: unknown): Project =>
  validateCurrent(upgradeProject(value).project);

/** Reads a JSON file and validates it, e.g. `await loadJson("edit/project.json", validateProject)`. */
export async function loadJson<T>(path: string, validate: (value: unknown) => T): Promise<T> {
  const text = await readFile(path, "utf8");
  try {
    return validate(JSON.parse(text));
  } catch (error) {
    if (!(error instanceof SchemaError || error instanceof SyntaxError)) throw error;
    throw new SchemaError(`${path}:\n${error.message}`, { cause: error });
  }
}

const ASPECTS = { "9:16": [9, 16], "1:1": [1, 1], "16:9": [16, 9] } as const;
const PICTURE: Kind[] = ["video", "image"];
const SOUND: Kind[] = ["video", "audio"];
// Normalised coordinates are floats, so 0.2 + 0.8 may land a hair above 1.
const EDGE = 1 + 1e-9;

type Kind = Source["kind"];

/** The ticks a transition takes from the end of the clip before it and from the start of its own
 * clip. A dip splits on whole ticks. */
function overlap(transition: Clip["transition"]): [before: number, own: number] {
  if (!transition) return [0, 0];
  if (transition.type === "dissolve") return [transition.duration, transition.duration];
  const before = Math.floor(transition.duration / 2);
  return [before, transition.duration - before];
}

function projectProblems(project: Project): string[] {
  const problems: string[] = [];
  const kinds = new Map<string, Kind>();
  for (const [i, source] of project.sources.entries()) {
    if (kinds.has(source.id)) problems.push(`/sources/${i}/id: ${source.id} is used twice`);
    kinds.set(source.id, source.kind);
  }
  const source = (path: string, id: string, allowed?: Kind[]) => {
    const kind = kinds.get(id);
    if (kind === undefined) problems.push(`${path}: no source has the id ${id}`);
    else if (allowed && !allowed.includes(kind)) {
      problems.push(`${path}: ${id} is ${kind}, not ${allowed.join(" or ")}`);
    }
  };
  const range = (path: string, start: number, end: number) => {
    if (end <= start) problems.push(`${path}: ends at ${end}, not after its start ${start}`);
  };
  const inside = (path: string, rect: Rect) => {
    if (rect.x + rect.w > EDGE || rect.y + rect.h > EDGE) {
      problems.push(`${path}: x + w and y + h may not exceed 1`);
    }
  };
  const onPicture = (path: string, rect: CropRect) => {
    if (rect.x >= 1 || rect.y >= 1 || rect.x + rect.w <= 0 || rect.y + rect.h <= 0) {
      problems.push(`${path}: lies wholly off the picture`);
    }
  };

  const { fps, aspect, width, height } = project.output;
  try {
    ticksPerFrame(fps);
  } catch (error) {
    problems.push(`/output/fps: ${(error as Error).message}`);
  }
  const [w, h] = ASPECTS[aspect];
  if (width * h !== height * w) problems.push(`/output: ${width}x${height} is not ${aspect}`);

  const clips = [
    ...project.main.map((clip, i) => [`/main/${i}`, clip] as const),
    ...(project.broll ?? []).map((clip, i) => [`/broll/${i}`, clip] as const),
  ];
  for (const [path, clip] of clips) {
    source(`${path}/source`, clip.source, PICTURE);
    range(path, clip.in, clip.out);
    if (kinds.get(clip.source) === "image" && clip.in !== 0) {
      problems.push(`${path}/in: an image has no time of its own, so its clips start at 0`);
    }
    if ("rect" in clip && clip.rect) inside(`${path}/rect`, clip.rect);
    if (clip.grade?.match) {
      source(`${path}/grade/match/reference`, clip.grade.match.reference, PICTURE);
    }
    const forward = (at: string, keyframes: readonly { t: number }[]) => {
      for (const [k, key] of keyframes.entries()) {
        const before = keyframes[k - 1];
        if (before && key.t <= before.t) {
          problems.push(`${at}/keyframes/${k}/t: not after the keyframe before`);
        }
      }
    };
    const crop = clip.framing?.crop;
    if (crop?.type === "static") {
      onPicture(`${path}/framing/crop/rect`, crop.rect);
      if (crop.below) onPicture(`${path}/framing/crop/below`, crop.below);
    }
    if (crop?.type === "path") {
      forward(`${path}/framing/crop`, crop.keyframes);
      for (const [k, key] of crop.keyframes.entries()) {
        onPicture(`${path}/framing/crop/keyframes/${k}/rect`, key.rect);
        if (key.below) onPicture(`${path}/framing/crop/keyframes/${k}/below`, key.below);
        const before = crop.keyframes[k - 1];
        if (before && key.t - before.t > 1 && !sameShape(before, key)) {
          problems.push(
            `${path}/framing/crop/keyframes/${k}: changes size or split more than a tick after the keyframe before`,
          );
        }
      }
    }
    const scale = clip.framing?.scale;
    if (typeof scale === "object") forward(`${path}/framing/scale`, scale.keyframes);
  }
  if (project.main[0].transition) {
    problems.push("/main/0/transition: the first clip has no clip before it");
  }
  for (const [i, clip] of project.main.entries()) {
    const used = overlap(clip.transition)[1] + overlap(project.main[i + 1]?.transition)[0];
    const length = clip.out - clip.in;
    if (length > 0 && used > length) {
      problems.push(`/main/${i}: its transitions need ${used} ticks, but it lasts ${length}`);
    }
  }
  for (const [i, line] of (project.captions?.lines ?? []).entries()) {
    range(`/captions/lines/${i}`, line.start, line.end);
    for (const [k, word] of (line.words ?? []).entries()) {
      const path = `/captions/lines/${i}/words/${k}`;
      range(path, word.start, word.end);
      if (word.start < line.start || word.end > line.end) {
        problems.push(`${path}: outside its line, ${line.start} to ${line.end}`);
      }
    }
  }
  const voiced = new Set<string>();
  for (const [i, voice] of (project.audio.voice ?? []).entries()) {
    source(`/audio/voice/${i}/source`, voice.source, SOUND);
    if (voiced.has(voice.source)) {
      problems.push(`/audio/voice/${i}/source: ${voice.source} already has a voice decision`);
    }
    voiced.add(voice.source);
  }
  for (const [i, music] of (project.audio.music ?? []).entries()) {
    source(`/audio/music/${i}/source`, music.source, ["audio"]);
    range(`/audio/music/${i}`, music.in, music.out);
  }
  for (const [i, sfx] of (project.audio.sfx ?? []).entries()) {
    source(`/audio/sfx/${i}/source`, sfx.source, ["audio"]);
  }
  for (const [i, dropped] of (project.plan?.dropped ?? []).entries()) {
    source(`/plan/dropped/${i}/source`, dropped.source);
    range(`/plan/dropped/${i}`, dropped.in, dropped.out);
  }
  for (const [i, moment] of (project.plan?.emphasis ?? []).entries()) {
    range(`/plan/emphasis/${i}`, moment.start, moment.end);
  }
  return problems;
}

/** Whether two crop keyframes have rects of one size, and both split the area or neither does. */
function sameShape(a: CropKeyframe, b: CropKeyframe): boolean {
  const same = (p: CropRect, q: CropRect) => p.w === q.w && p.h === q.h;
  if (!same(a.rect, b.rect)) return false;
  if (!a.below || !b.below) return !a.below && !b.below;
  return same(a.below, b.below);
}
