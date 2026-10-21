// Burned-in captions and their SubRip copy, from project.json's `captions`.

import { copyFile, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { BrandColors } from "@video-editor/effects/colour";
import {
  type BrandCaptions,
  type Captions,
  type Project,
  secondsToTicks,
} from "@video-editor/schema";
import type { BrandFace } from "../brand/kit.ts";
import type { Timeline } from "../timeline.ts";
import { type CaptionFace, writeAss } from "./ass.ts";
import { faceZones, overlayZones, visualZones } from "./faces.ts";
import { family, fontFile, type Metrics, metrics } from "./fonts.ts";
import { layoutCaptions, type Page, rowText } from "./layout.ts";
import { placeBlocks } from "./place.ts";
import {
  brandPreset,
  type DrawnStyle,
  HOLD,
  LEADING,
  PRESETS,
  TAIL,
  TYPE_SCALE,
} from "./presets.ts";

export { type CaptionStyle, PRESETS, type Preset } from "./presets.ts";

type Box = { start: number; end: number; x: number; y: number; width: number; height: number };

export interface CaptionFiles {
  /** The ASS script libass draws, or null for the style `none`. */
  ass: string | null;
  /** The pages as SubRip: the same text, broken into the same rows, on the same frames as the
   * picture shows them; for `none`, as `bold` would. */
  srt: string;
  pages: Page[];
  /** The face files the script is drawn in, for stageFonts; none with no script. */
  fonts: string[];
}

/** A brand kit as captions take it: its colours, its custom captions and its caption face. */
export interface CaptionBrand {
  colors: BrandColors;
  custom?: BrandCaptions;
  face?: BrandFace | null;
}

/** Room kept around a caption's em boxes when moving it clear of a face, in ems. */
const CLEARANCE = 0.3;

type Placeable = Pick<Timeline, "main" | "broll" | "frames" | "frameTicks"> &
  Partial<Pick<Timeline, "graphics" | "overlays">>;

/** The pages of `style`, in a brand kit's look when given, where each is drawn, and what drawing
 * them takes. */
async function place(
  project: Project,
  timeline: Placeable,
  style: DrawnStyle,
  brand?: CaptionBrand,
) {
  const { captions, output } = project as Project & { captions: Captions };
  const custom = brand?.custom;
  const chosen = brand ? brandPreset(style, brand.colors, custom) : PRESETS[style];
  const scale = TYPE_SCALE[output.aspect];
  const { frameTicks } = timeline;
  const house = await fontFile(chosen.weight);
  const houseFace = { family: family(chosen.weight), bold: true, metrics: await metrics(house) };
  const own = brand?.face;
  const face: CaptionFace = own
    ? { family: own.family, bold: false, metrics: own.metrics, fallback: houseFace }
    : houseFace;
  const fonts = own ? [own.path, house] : [house];
  // A character the kit's face lacks is measured, as it is drawn, in the house face.
  const measured: Metrics = own
    ? { ...own.metrics, advance: (c) => own.metrics.advance(c) ?? houseFace.metrics.advance(c) }
    : houseFace.metrics;
  const em = scale.em * Math.min(output.width, output.height) * chosen.scale;
  const rows = custom?.lines ?? (chosen.chunk ? 1 : scale.rows);
  const pages = layoutCaptions(captions, measured, {
    maxWidth:
      (chosen.chunk?.chars ?? Math.floor(scale.chars / chosen.scale)) * (1 + chosen.tracking),
    maxRows: rows,
    ...(chosen.chunk ? { maxWords: chosen.chunk.words * rows } : {}),
    keywords: chosen.keyword !== undefined,
    tracking: chosen.tracking,
    frameTicks,
    hold: secondsToTicks(HOLD / 1000),
    tail: secondsToTicks(TAIL / 1000),
    frames: timeline.frames,
  });
  const blocks = pages.map((page) => {
    const widest = Math.max(...page.rows.map((row) => row.width));
    const height = 1 + (page.rows.length - 1) * LEADING + 2 * CLEARANCE;
    const shot = timeline.main.findLastIndex((clip) => clip.start <= page.start);
    return {
      start: page.start,
      end: page.end,
      shot,
      left: output.width / 2 - (widest / 2 + CLEARANCE) * em,
      right: output.width / 2 + (widest / 2 + CLEARANCE) * em,
      height: height * em,
    };
  });
  // A caption sits at its aspect's place, or the custom captions' own, inside the platforms' safe
  // area, unless a face the media index found is under it. Custom captions also keep clear of
  // the labels, lower thirds and titles, which were placed clear of the house captions alone.
  const band: [number, number] = [scale.band[0] * output.height, scale.band[1] * output.height];
  const position = custom?.position ?? "bottom";
  const rest = (height: number) =>
    position === "top"
      ? band[0] + height
      : position === "middle"
        ? (output.height + height) / 2
        : scale.bottom * output.height + CLEARANCE * em;
  const bottoms = placeBlocks(blocks, rest, band, [
    ...faceZones(timeline, output),
    ...visualZones(timeline, output),
    ...(custom ? overlayZones(timeline, output) : []),
  ]).map((bottom) => bottom - CLEARANCE * em);
  const boxes = blocks.map((block, i): Box => {
    const bottom = (bottoms[i] as number) + CLEARANCE * em;
    return {
      start: block.start,
      end: block.end,
      x: block.left,
      y: bottom - block.height,
      width: block.right - block.left,
      height: block.height,
    };
  });
  // The width the aspect keeps captions to (70 % of a 9:16 frame), in this style's ems.
  const fit = (scale.chars / chosen.scale) * (1 + chosen.tracking);
  return { chosen, fonts, face, em, pages, bottoms, boxes, fit };
}

/**
 * Lays out, places and writes the project's captions. Fails, naming the line, on a character the
 * caption font cannot draw, so a caption never shows a box.
 */
export async function buildCaptions(
  project: Project,
  timeline: Placeable,
  brand?: CaptionBrand,
): Promise<CaptionFiles | null> {
  const { captions, output } = project;
  if (!captions) return null;
  // Custom captions draw their own style; none draws nothing, and its SubRip copy is bold's.
  const style = captions.preset === "none" ? null : (brand?.custom?.style ?? captions.preset);
  const { chosen, fonts, face, em, pages, bottoms, fit } = await place(
    project,
    timeline,
    style ?? "bold",
    style ? brand : undefined,
  );
  const geometry = {
    width: output.width,
    height: output.height,
    em,
    frameTicks: timeline.frameTicks,
    // In a kit's look, a page too wide for the frame, as a long word in a large size can be, is
    // set smaller to fit.
    ...(brand ? { fit } : {}),
  };
  return {
    ass: style ? writeAss(pages, bottoms, chosen, face, geometry) : null,
    srt: toSrt(pages, timeline.frameTicks),
    pages,
    fonts: style ? fonts : [],
  };
}

/**
 * Where the project's captions may be drawn, in output pixels over output frames [start, end):
 * in each stretch, the box that holds the captions of every style there. The style changes with
 * a render alone, so a graphic keeps its text off all of them. Empty without captions.
 */
export async function captionAreas(project: Project, timeline: Placeable): Promise<Box[]> {
  if (!project.captions) return [];
  const all: Box[] = [];
  for (const style of Object.keys(PRESETS) as DrawnStyle[]) {
    all.push(...(await place(project, timeline, style)).boxes);
  }
  const times = [...new Set(all.flatMap((box) => [box.start, box.end]))].sort((a, b) => a - b);
  const areas: Box[] = [];
  for (const [i, start] of times.entries()) {
    const end = times[i + 1];
    if (end === undefined) break;
    const here = all.filter((box) => box.start < end && box.end > start);
    if (here.length === 0) continue;
    const x = Math.min(...here.map((box) => box.x));
    const y = Math.min(...here.map((box) => box.y));
    const width = Math.max(...here.map((box) => box.x + box.width)) - x;
    const height = Math.max(...here.map((box) => box.y + box.height)) - y;
    const last = areas.at(-1);
    if (
      last?.end === start &&
      last.x === x &&
      last.y === y &&
      last.width === width &&
      last.height === height
    ) {
      last.end = end;
    } else {
      areas.push({ start, end, x, y, width, height });
    }
  }
  return areas;
}

/** A frame's start as a SubRip time: the millisecond before it, as assTime does, so a player
 * that works the frame's time out in floating point still shows the cue from that frame and
 * the cue before it no longer. Rounding to the nearest would end a cue up to half a millisecond
 * after the next frame starts. */
function srtTime(frame: number, frameTicks: number): string {
  const ms = frame > 0 ? Math.floor((frame * frameTicks - 120) / 120) : 0;
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  const hours = Math.floor(ms / 3_600_000);
  return `${pad(hours)}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

function toSrt(pages: Page[], frameTicks: number): string {
  return pages
    .map((page, i) => {
      const time = `${srtTime(page.start, frameTicks)} --> ${srtTime(page.end, frameTicks)}`;
      return `${i + 1}\n${time}\n${page.rows.map(rowText).join("\n")}\n`;
    })
    .join("\n");
}

/** The folder, inside FFmpeg's working folder, that libass loads the caption faces from. */
export const FONTS = "fonts";

/**
 * Puts `faces` in `folder`'s FONTS folder and returns the environment FFmpeg runs in there.
 * libass loads the faces itself whichever font provider it uses (fontconfig, CoreText or
 * DirectWrite), so a caption looks the same on every machine. Fontconfig is shown no fonts at
 * all, so on Linux a system copy of the family cannot be picked instead.
 */
export async function stageFonts(folder: string, faces: string[]): Promise<NodeJS.ProcessEnv> {
  const dir = join(folder, FONTS);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  for (const face of faces) {
    const staged = join(dir, basename(face));
    // Windows lets only administrators and developer mode make symbolic links.
    await symlink(face, staged).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPERM") throw error;
      await copyFile(face, staged);
    });
  }
  const config = join(folder, "fonts.conf");
  await writeFile(
    config,
    '<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig></fontconfig>\n',
  );
  return { FONTCONFIG_FILE: config };
}
