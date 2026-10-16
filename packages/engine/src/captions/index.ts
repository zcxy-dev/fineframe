// Burned-in captions and their SubRip copy, from project.json's `captions`.

import { copyFile, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { type Project, secondsToTicks } from "@video-editor/schema";
import type { Timeline } from "../timeline.ts";
import { writeAss } from "./ass.ts";
import { faceZones } from "./faces.ts";
import { fontFile, metrics } from "./fonts.ts";
import { layoutCaptions, type Page, rowText } from "./layout.ts";
import { placeBlocks } from "./place.ts";
import { HOLD, LEADING, preset, TAIL, TYPE_SCALE } from "./presets.ts";

export { PRESETS } from "./presets.ts";

export interface CaptionFiles {
  /** The ASS script libass draws. */
  ass: string;
  /** The same pages as SubRip: the same text, broken into the same rows, on the same frames. */
  srt: string;
  pages: Page[];
  /** The face file the script is drawn in, for stageFonts. */
  font: string;
}

/** Room kept around a caption's em boxes when moving it clear of a face, in ems. */
const CLEARANCE = 0.3;

/**
 * Lays out, places and writes the project's captions. Fails, naming the line, on a character the
 * caption font cannot draw, so a caption never shows a box.
 */
export async function buildCaptions(
  project: Project,
  timeline: Pick<Timeline, "main" | "broll" | "frames" | "frameTicks">,
): Promise<CaptionFiles | null> {
  const { captions, output } = project;
  if (!captions) return null;
  const chosen = preset(captions.preset);
  const scale = TYPE_SCALE[output.aspect];
  const { frameTicks } = timeline;
  const font = await fontFile(chosen.weight);
  const face = await metrics(font);
  const em = scale.em * Math.min(output.width, output.height) * chosen.scale;
  const pages = layoutCaptions(captions, face, {
    maxWidth: Math.floor(scale.chars / chosen.scale) * (1 + chosen.tracking),
    maxRows: scale.rows,
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
  // A caption sits at its aspect's place, inside the platforms' safe area, unless a face the
  // media index found is under it.
  const bottoms = placeBlocks(
    blocks,
    scale.bottom * output.height + CLEARANCE * em,
    [scale.band[0] * output.height, scale.band[1] * output.height],
    faceZones(timeline, output),
  ).map((bottom) => bottom - CLEARANCE * em);
  const geometry = { width: output.width, height: output.height, em, frameTicks };
  return {
    ass: writeAss(pages, bottoms, chosen, face, geometry),
    srt: toSrt(pages, frameTicks),
    pages,
    font,
  };
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

export function toSrt(pages: Page[], frameTicks: number): string {
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
