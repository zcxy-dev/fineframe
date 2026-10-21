// An edit exported for an editing app: timeline files for Final Cut and Resolve (FCPXML) and for
// Premiere (Final Cut Pro 7 XML), with the files they play that are not the footage itself.

import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { ffmpeg, ffprobe } from "../ffmpeg.ts";
import { captionsFor, loadEdit, type RenderOptions, renderEffects } from "../render.ts";
import { fcpxml } from "./fcpxml.ts";
import { type Media, readMedia } from "./media.ts";
import { nleTimeline, OVERLAY } from "./model.ts";
import { hasOverlay, renderOverlay } from "./overlay.ts";
import { xmeml } from "./xmeml.ts";

/** Where a timeline file finds each file: copied into the export, by a path relative to it, or
 * where it already is on this computer. */
export type Locations = ReadonlyMap<string, { relative: string } | { absolute: string }>;

export interface ExportResult {
  /** Absolute paths of what the export wrote, the folder first. */
  folder: string;
  files: string[];
}

/** The folder the copies go in, beside the timeline files. */
const MEDIA_FOLDER = "media";

/** What the folder holds and how to open it, in English and Traditional Chinese. */
function readme(name: string, overlay: boolean, captions: boolean): string {
  const lines = [
    `${name}.fcpxml: open in Final Cut Pro (File > Import > XML) or DaVinci Resolve (File > Import > Timeline).`,
    `${name}.xml: open in Premiere Pro (File > Import).`,
    `${MEDIA_FOLDER}/: the B-roll, music and sound effects the edit plays${overlay ? ", and overlay.mov, the graphics over transparency on the top track" : ""}. Keep it beside the timeline files.`,
    ...(captions ? [`${name}.srt: the captions, to import as subtitles.`] : []),
    "The footage is not copied: the timelines play it where it is on this computer.",
    "Not included: the colour grade, the voice processing, the loudness normalisation and the blurred fill behind framing that reaches past the picture; the footage plays as recorded.",
    "",
    `${name}.fcpxml：在 Final Cut Pro（檔案 > 輸入 > XML）或 DaVinci Resolve（File > Import > Timeline）開啟。`,
    `${name}.xml：在 Premiere Pro（檔案 > 讀入）開啟。`,
    `${MEDIA_FOLDER}/：剪輯用到的 B-roll、音樂和音效${overlay ? "，以及 overlay.mov：最上層的透明動態圖卡" : ""}。請和時間軸檔放在同一個資料夾。`,
    ...(captions ? [`${name}.srt：字幕，可匯入為字幕軌。`] : []),
    "原始素材沒有複製：時間軸直接讀取素材在這台電腦上的位置。",
    "沒有包含：調色、人聲處理、響度標準化，以及取景超出畫面時的模糊背景；素材以原始畫面和聲音播放。",
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * Exports the edit `projectPath` describes into `folder`, which must be empty or new: `<name>.fcpxml`
 * and `<name>.xml`, named after the project, `<name>.srt` with its captions, the B-roll, music and
 * sound effects copied into `media/` with, when the edit draws graphics, effect overlays or a
 * watermark, `media/overlay.mov`, and `README.txt`. The footage on the main track, and the
 * owner's own files shown as B-roll, are not copied: the timelines name their absolute paths.
 */
export async function exportEdit(
  projectPath: string,
  folder: string,
  options: RenderOptions = {},
): Promise<ExportResult> {
  const out = resolve(folder);
  const there = await readdir(out).catch(() => []);
  if (there.length > 0)
    throw new Error(`${folder} is not empty; export into an empty or new folder`);
  const report = options.onProgress ?? (() => {});
  report(0, "Checking sources");
  const { project, sources, brand, timeline } = await loadEdit(projectPath, options.onDownload);
  const captions = await captionsFor(project, timeline, brand);
  const probe = await ffprobe();
  const media = new Map<string, Media>();
  for (const facts of sources.values()) media.set(facts.id, await readMedia(facts, probe));

  await mkdir(join(out, MEDIA_FOLDER), { recursive: true });
  const name = basename(projectPath).replace(/(\.project)?\.json$/, "");
  const files: string[] = [];
  const locations = new Map<string, { relative: string } | { absolute: string }>();
  const onMain = new Set(project.main.map((clip) => clip.source));
  const taken = new Set<string>();
  for (const source of project.sources) {
    const facts = sources.get(source.id);
    if (!facts) continue;
    // The footage stays where it is: what the main track plays, and an image or video of the
    // owner's own shown as B-roll, which unlike stock footage and captures carries no credit.
    const own = onMain.has(source.id) || (source.kind !== "audio" && !source.credit);
    if (own) {
      locations.set(source.id, { absolute: facts.path });
      continue;
    }
    const copy = freeName(basename(facts.path), taken);
    await copyFile(facts.path, join(out, MEDIA_FOLDER, copy));
    files.push(join(out, MEDIA_FOLDER, copy));
    locations.set(source.id, { relative: `${MEDIA_FOLDER}/${copy}` });
  }

  const overlay = hasOverlay(timeline, brand);
  if (overlay) {
    const bin = await ffmpeg();
    const share = 0.5;
    const effects = await renderEffects(project, timeline, brand, bin, {
      ...options,
      onProgress: (fraction, message) => report(fraction * share, message),
    });
    const path = join(out, MEDIA_FOLDER, "overlay.mov");
    await renderOverlay(timeline, effects, brand, bin, path, (fraction, message) =>
      report(share + fraction * (1 - share), message),
    );
    const { width, height, fps } = project.output;
    media.set(OVERLAY, {
      id: OVERLAY,
      kind: "video",
      path,
      width,
      height,
      rate: fps,
      duration: timeline.frames * timeline.frameTicks,
      start: 0,
      timecode: 0,
      channels: 0,
      sampleRate: 48_000,
    });
    locations.set(OVERLAY, { relative: `${MEDIA_FOLDER}/overlay.mov` });
    files.push(path);
  }

  const nle = nleTimeline(timeline, media, overlay);
  const srt = captions && (project.captions?.lines.length ?? 0) > 0 ? captions.srt : null;
  const written: [string, string][] = [
    [`${name}.fcpxml`, fcpxml(nle, locations, name)],
    [`${name}.xml`, xmeml(nle, locations, name)],
    ...(srt ? [[`${name}.srt`, srt] as [string, string]] : []),
    ["README.txt", readme(name, overlay, srt !== null)],
  ];
  for (const [file, text] of written) {
    await writeFile(join(out, file), text);
    files.unshift(join(out, file));
  }
  report(1, "Finished");
  return { folder: out, files };
}

/** `name`, or `name-2`, `name-3`… before its extension, whichever is not yet taken. */
function freeName(name: string, taken: Set<string>): string {
  const extension = extname(name);
  const stem = name.slice(0, name.length - extension.length);
  let candidate = name;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${stem}-${n}${extension}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}
