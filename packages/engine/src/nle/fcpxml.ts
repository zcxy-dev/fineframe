// The timeline as FCPXML, which Final Cut Pro and DaVinci Resolve open.

import type { Locations } from "./export.ts";
import type { Media } from "./media.ts";
import type { GainKey, NleClip, NleTimeline, Picture } from "./model.ts";
import { fileUrl, frames, rational, relativeUrl, xmlText } from "./xml.ts";

/** Final Cut's own Cross Dissolve. */
const CROSS_DISSOLVE = "FxPlug:4731E73A-8DAC-4113-9A30-AE85B1761265";
/** The quietest level a keyframe or a muted clip takes. */
const SILENT_DB = -96;

/** The URL a timeline file names a file by. */
export function hrefOf(locations: Locations, id: string, host = ""): string {
  const at = locations.get(id);
  if (!at) throw new Error(`No location for ${id}`);
  return "relative" in at ? relativeUrl(at.relative) : fileUrl(at.absolute, host);
}

/** A level in decibels as FCPXML writes it, silence at SILENT_DB. */
function db(gain: number): string {
  return `${Number(Math.max(SILENT_DB, gain).toFixed(2))}dB`;
}

/**
 * Where FCPXML puts a picture. Final Cut and Resolve fit a file of another size into the frame
 * (spatial conform "fit"), which `scale` multiplies; `position` moves the file's centre from the
 * frame's, in percent of the frame's height, up positive. The crop trims the fitted file to the
 * part shown, in percent of the frame's height, when the picture fills less than the frame.
 */
export function placementOf(
  picture: Picture,
  media: Pick<Media, "width" | "height">,
  output: { width: number; height: number },
) {
  const { view, box } = picture;
  const fit = Math.min(output.width / media.width, output.height / media.height);
  const scale = box.width / (view.w * media.width);
  // Where the file's centre lands, in output pixels.
  const x = box.x + box.width / 2 + (0.5 - (view.x + view.w / 2)) * media.width * scale;
  const y = box.y + box.height / 2 + (0.5 - (view.y + view.h / 2)) * media.height * scale;
  const percent = (pixels: number) => (pixels / output.height) * 100;
  const trim = (share: number, size: number) => percent(Math.max(0, share) * size * fit);
  return {
    scale: scale / fit,
    position: [percent(x - output.width / 2), percent(output.height / 2 - y)] as const,
    crop: picture.crop
      ? {
          left: trim(view.x, media.width),
          right: trim(1 - view.x - view.w, media.width),
          top: trim(view.y, media.height),
          bottom: trim(1 - view.y - view.h, media.height),
        }
      : null,
  };
}

const num = (value: number) => String(Number(value.toFixed(4)));

/** The FCPXML of the timeline, named `name`, its files found as `locations` says. */
export function fcpxml(nle: NleTimeline, locations: Locations, name: string): string {
  const { output } = nle;
  const { fps } = output;
  const ids = new Map<string, string>();
  const resources: string[] = [];
  let next = 1;
  const id = () => `r${next++}`;
  const sequenceFormat = id();
  resources.push(
    `<format id="${sequenceFormat}" frameDuration="${frames(1, fps)}" width="${output.width}" height="${output.height}" colorSpace="1-1-1 (Rec. 709)"/>`,
  );
  const dissolve = id();
  resources.push(`<effect id="${dissolve}" name="Cross Dissolve" uid="${CROSS_DISSOLVE}"/>`);
  const crossfade = id();
  resources.push(`<effect id="${crossfade}" name="Audio Crossfade" uid="FFAudioTransition"/>`);
  const asset = (m: Media): string => {
    const known = ids.get(m.id);
    if (known) return known;
    let format = "";
    if (m.kind !== "audio") {
      format = id();
      const duration = m.rate ? ` frameDuration="${frames(1, m.rate)}"` : "";
      const named = m.rate ? "" : ` name="FFVideoFormatRateUndefined"`;
      resources.push(
        `<format id="${format}"${named}${duration} width="${m.width}" height="${m.height}"/>`,
      );
    }
    const ref = id();
    const video = m.kind === "audio" ? "" : ` hasVideo="1" format="${format}"`;
    const audio =
      m.channels > 0
        ? ` hasAudio="1" audioSources="1" audioChannels="${m.channels}" audioRate="${m.sampleRate}"`
        : "";
    const name = xmlText(m.path.split(/[\\/]/).at(-1) ?? m.id);
    resources.push(
      `<asset id="${ref}" name="${name}" start="${rational(m.timecode)}" duration="${rational(m.duration)}"${video}${audio} src="${xmlText(hrefOf(locations, m.id))}"/>`,
    );
    ids.set(m.id, ref);
    return ref;
  };
  const file = (clip: NleClip) => {
    const m = nle.media.get(clip.media);
    if (!m) throw new Error(`No media facts for ${clip.media}`);
    return m;
  };

  /** A clip's element, its timing from `offset` on its parent's time, with `children`: an image
   * as `video`, every other file as `asset-clip`. */
  const element = (clip: NleClip, offset: string, lane: number | null, children: string[] = []) => {
    const m = file(clip);
    const ref = asset(m);
    const tag = m.kind === "image" ? "video" : "asset-clip";
    const attrs = [
      `ref="${ref}"`,
      ...(lane === null ? [] : [`lane="${lane}"`]),
      `offset="${offset}"`,
      `name="${xmlText(m.path.split(/[\\/]/).at(-1) ?? m.id)}"`,
      `start="${rational(local(clip, 0))}"`,
      `duration="${frames(clip.end - clip.start, fps)}"`,
      ...(tag === "asset-clip" && m.kind !== "audio" ? [`tcFormat="NDF"`] : []),
      ...(clip.sound && clip.sound.role !== "dialogue" ? [`audioRole="${clip.sound.role}"`] : []),
    ];
    const inner: string[] = [];
    if (clip.picture) {
      const at = placementOf(clip.picture, m, output);
      if (at.crop) {
        const { left, top, right, bottom } = at.crop;
        inner.push(
          `<adjust-crop mode="trim"><trim-rect left="${num(left)}" top="${num(top)}" right="${num(right)}" bottom="${num(bottom)}"/></adjust-crop>`,
        );
      }
      inner.push(
        `<adjust-transform position="${num(at.position[0])} ${num(at.position[1])}" scale="${num(at.scale)} ${num(at.scale)}"/>`,
      );
    }
    if (tag === "asset-clip") inner.push(volume(clip));
    inner.push(...children);
    return inner.some((part) => part !== "")
      ? `<${tag} ${attrs.join(" ")}>${inner.join("")}</${tag}>`
      : `<${tag} ${attrs.join(" ")}/>`;
  };

  /** The clip's own time `frame` frames into it: its file's timecode, then its in point. An
   * image's file has no time of its own. */
  const local = (clip: NleClip, frame: number) =>
    file(clip).kind === "image"
      ? frame * nle.frameTicks
      : file(clip).timecode + clip.in + frame * nle.frameTicks;

  /** The clip's level, its keyframes on its own time; silent when its sound is not heard, as
   * B-roll's own sound is unless it has a gain. */
  const volume = (clip: NleClip) => {
    if (!file(clip).channels) return "";
    if (!clip.sound) return `<adjust-volume amount="${db(-Infinity)}"/>`;
    const { gainDb, keys } = clip.sound;
    if (keys.length === 0) return gainDb === 0 ? "" : `<adjust-volume amount="${db(gainDb)}"/>`;
    const at = (key: GainKey) => rational(local(clip, key.frame));
    return (
      `<adjust-volume amount="${db(gainDb)}"><param name="amount"><keyframeAnimation>` +
      keys.map((key) => `<keyframe time="${at(key)}" value="${db(key.gainDb)}"/>`).join("") +
      "</keyframeAnimation></param></adjust-volume>"
    );
  };

  // Every clip off the main track hangs from the main-track clip its start falls in, at its
  // place on that clip's own time: lanes 1 up for pictures, -1 down for sound alone.
  const [main = [], ...above] = nle.video;
  const connected = new Map<NleClip, string[]>();
  const hang = (clip: NleClip, lane: number) => {
    const parent = main.findLast((p) => p.start <= clip.start) ?? main[0];
    if (!parent) throw new Error("The edit has no main track");
    const offset = rational(local(parent, clip.start - parent.start));
    const list = connected.get(parent) ?? [];
    list.push(element(clip, offset, lane));
    connected.set(parent, list);
  };
  for (const [k, track] of above.entries()) for (const clip of track) hang(clip, k + 1);
  for (const [k, track] of nle.audio.entries()) for (const clip of track) hang(clip, -(k + 1));

  const spine: string[] = [];
  for (const clip of main) {
    if (clip.dissolve) {
      const { before, after } = clip.dissolve;
      spine.push(
        `<transition name="Cross Dissolve" offset="${frames(clip.start - before, fps)}" duration="${frames(before + after, fps)}"><filter-video ref="${dissolve}" name="Cross Dissolve"/><filter-audio ref="${crossfade}" name="Audio Crossfade"/></transition>`,
      );
    }
    spine.push(element(clip, frames(clip.start, fps), null, connected.get(clip) ?? []));
  }
  const length = frames(nle.frames, fps);
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE fcpxml>`,
    `<fcpxml version="1.8">`,
    `<resources>${resources.join("")}</resources>`,
    `<library><event name="${xmlText(name)}"><project name="${xmlText(name)}">`,
    `<sequence format="${sequenceFormat}" duration="${length}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">`,
    `<spine>${spine.join("")}</spine>`,
    `</sequence></project></event></library>`,
    `</fcpxml>`,
    "",
  ].join("\n");
}
