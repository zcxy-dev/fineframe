// The timeline as Final Cut Pro 7 XML (xmeml), which Premiere Pro opens.

import { type FrameRate, TICKS_PER_SECOND } from "@video-editor/schema";
import type { Locations } from "./export.ts";
import { hrefOf } from "./fcpxml.ts";
import type { Media } from "./media.ts";
import type { NleClip, NleTimeline, Picture } from "./model.ts";
import { xmlText } from "./xml.ts";

/** A rate as xmeml writes it: the whole frames a second it rounds to, and whether it is the
 * NTSC rate 1000/1001 of that. */
function rate(fps: FrameRate): string {
  const timebase = Math.round(fps.num / fps.den);
  return `<rate><timebase>${timebase}</timebase><ntsc>${fps.den === 1001 ? "TRUE" : "FALSE"}</ntsc></rate>`;
}

function timecode(fps: FrameRate): string {
  return `<timecode>${rate(fps)}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>`;
}

const num = (value: number) => String(Number(value.toFixed(6)));

/**
 * Where xmeml puts a picture, in its Basic Motion: `scale` in percent of the file's own pixel
 * size, and `center` the file's centre from the frame's, in output pixels over the file's own
 * width and height, down positive, as Premiere writes it. The Crop filter trims the file to the part shown, in percent of its
 * width and height, when the picture fills less than the frame.
 */
export function motionOf(
  picture: Picture,
  media: Pick<Media, "width" | "height">,
  output: { width: number; height: number },
) {
  const { view, box } = picture;
  const scale = box.width / (view.w * media.width);
  const x = box.x + box.width / 2 + (0.5 - (view.x + view.w / 2)) * media.width * scale;
  const y = box.y + box.height / 2 + (0.5 - (view.y + view.h / 2)) * media.height * scale;
  const clamp = (v: number) => Math.max(0, v) * 100;
  return {
    scale: scale * 100,
    center: [(x - output.width / 2) / media.width, (y - output.height / 2) / media.height] as const,
    crop: picture.crop
      ? {
          left: clamp(view.x),
          right: clamp(1 - view.x - view.w),
          top: clamp(view.y),
          bottom: clamp(1 - view.y - view.h),
        }
      : null,
  };
}

function parameter(id: string, name: string, value: string, range?: [number, number]): string {
  const bounds = range ? `<valuemin>${range[0]}</valuemin><valuemax>${range[1]}</valuemax>` : "";
  return `<parameter authoringApp="PremierePro"><parameterid>${id}</parameterid><name>${name}</name>${bounds}<value>${value}</value></parameter>`;
}

/** The xmeml of the timeline, named `name`, its files found as `locations` says. */
export function xmeml(nle: NleTimeline, locations: Locations, name: string): string {
  const { output } = nle;
  const { fps } = output;
  const files = new Map<string, string>();
  let clips = 0;
  const frameOf = (ticks: number) => Math.round(ticks / nle.frameTicks);

  const file = (m: Media): string => {
    const known = files.get(m.id);
    if (known) return `<file id="${known}"/>`;
    const id = `file-${files.size + 1}`;
    files.set(m.id, id);
    const video =
      m.kind === "audio"
        ? ""
        : `<video><samplecharacteristics>${rate(fps)}<width>${m.width}</width><height>${m.height}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></video>`;
    const audio =
      m.channels > 0
        ? `<audio><samplecharacteristics><depth>16</depth><samplerate>${m.sampleRate}</samplerate></samplecharacteristics><channelcount>${m.channels}</channelcount></audio>`
        : "";
    // In the file's own frames; a still lasts as long as the edit.
    const own = m.rate ?? fps;
    const length =
      m.kind === "image"
        ? nle.frames
        : Math.round((m.duration * own.num) / (own.den * TICKS_PER_SECOND));
    const fileName = xmlText(m.path.split(/[\\/]/).at(-1) ?? m.id);
    return `<file id="${id}"><name>${fileName}</name><pathurl>${xmlText(hrefOf(locations, m.id, "localhost"))}</pathurl>${rate(own)}<duration>${length}</duration><media>${video}${audio}</media></file>`;
  };
  const media = (clip: NleClip) => {
    const m = nle.media.get(clip.media);
    if (!m) throw new Error(`No media facts for ${clip.media}`);
    return m;
  };

  /** A clip item: the clip's frames on the sequence and in its file, with `inner` after its file. */
  const item = (clip: NleClip, id: string, inner: string[], head = 0, tail = 0) => {
    const m = media(clip);
    const first = m.kind === "image" ? 0 : frameOf(clip.in);
    const start = head > 0 ? -1 : clip.start;
    const end = tail > 0 ? -1 : clip.end;
    const fileName = xmlText(m.path.split(/[\\/]/).at(-1) ?? m.id);
    const alpha = clip.media === "overlay" ? "<alphatype>straight</alphatype>" : "";
    return (
      `<clipitem id="${id}"><name>${fileName}</name><enabled>TRUE</enabled>` +
      `<duration>${m.kind === "image" ? nle.frames : frameOf(m.duration)}</duration>${rate(fps)}` +
      `<start>${start}</start><end>${end}</end>` +
      `<in>${first - head}</in><out>${first + clip.end - clip.start + tail}</out>${alpha}` +
      `${file(m)}${inner.join("")}</clipitem>`
    );
  };

  const motion = (clip: NleClip) => {
    if (!clip.picture) return [];
    const at = motionOf(clip.picture, media(clip), output);
    const effects = [
      `<filter><effect><name>Basic Motion</name><effectid>basic</effectid><effectcategory>motion</effectcategory><effecttype>motion</effecttype><mediatype>video</mediatype>` +
        parameter("scale", "Scale", num(at.scale), [0, 1000]) +
        parameter(
          "center",
          "Center",
          `<horiz>${num(at.center[0])}</horiz><vert>${num(at.center[1])}</vert>`,
        ) +
        "</effect></filter>",
    ];
    if (at.crop) {
      const { left, right, top, bottom } = at.crop;
      effects.push(
        `<filter><effect><name>Crop</name><effectid>crop</effectid><effectcategory>motion</effectcategory><effecttype>motion</effecttype><mediatype>video</mediatype>` +
          parameter("left", "left", num(left), [0, 100]) +
          parameter("right", "right", num(right), [0, 100]) +
          parameter("top", "top", num(top), [0, 100]) +
          parameter("bottom", "bottom", num(bottom), [0, 100]) +
          "</effect></filter>",
      );
    }
    return effects;
  };

  /** Audio Levels: a linear gain, 1 for 0 dB, keyed on the clip's frames from its in point. */
  const levels = (clip: NleClip) => {
    const sound = clip.sound;
    const gain = (db: number) => num(db === -Infinity ? 0 : Math.min(3.98109, 10 ** (db / 20)));
    if (!sound) return [];
    if (sound.keys.length === 0 && sound.gainDb === 0) return [];
    const first = frameOf(clip.in);
    const keys = sound.keys
      .map(
        (key) =>
          `<keyframe><when>${first + key.frame}</when><value>${gain(key.gainDb)}</value></keyframe>`,
      )
      .join("");
    return [
      `<filter><effect><name>Audio Levels</name><effectid>audiolevels</effectid><effectcategory>audiolevels</effectcategory><effecttype>audiolevels</effecttype><mediatype>audio</mediatype>` +
        `<parameter authoringApp="PremierePro"><parameterid>level</parameterid><name>Level</name><valuemin>0</valuemin><valuemax>3.98109</valuemax><value>${gain(sound.gainDb)}</value>${keys}</parameter>` +
        "</effect></filter>",
    ];
  };

  const dissolve = (clip: NleClip, kind: "video" | "audio") => {
    if (!clip.dissolve) return "";
    const { before, after } = clip.dissolve;
    const effect =
      kind === "video"
        ? "<name>Cross Dissolve</name><effectid>Cross Dissolve</effectid><effectcategory>Dissolve</effectcategory><effecttype>transition</effecttype><mediatype>video</mediatype>"
        : "<name>Cross Fade (+3dB)</name><effectid>KGAudioTransCrossFade3dB</effectid><effecttype>transition</effecttype><mediatype>audio</mediatype>";
    return `<transitionitem><start>${clip.start - before}</start><end>${clip.start + after}</end><alignment>center</alignment>${rate(fps)}<effect>${effect}</effect></transitionitem>`;
  };

  // Each picture's clip item on its track, and each heard clip's sound on tracks of its own: one
  // per channel of a stereo file, as Premiere lays stereo out.
  type Item = { id: string; mediatype: "video" | "audio"; track: number; index: number };
  const items = new Map<NleClip, Item[]>();
  const placed = (clip: NleClip, mediatype: Item["mediatype"], track: number, index: number) => {
    const id = `clipitem-${++clips}`;
    items.set(clip, [...(items.get(clip) ?? []), { id, mediatype, track, index }]);
    return id;
  };
  const soundLists: NleClip[][] = [
    ...nle.video.flatMap((track) => {
      const heard = track.filter((clip) => clip.sound);
      return heard.length > 0 ? [heard] : [];
    }),
    ...nle.audio,
  ];
  const soundTracks = soundLists.flatMap((list) => {
    const stereo = list.filter((clip) => media(clip).channels >= 2);
    return [{ list, channel: 1 }, ...(stereo.length > 0 ? [{ list: stereo, channel: 2 }] : [])];
  });
  const videoIds = nle.video.map((list, t) =>
    list.map((clip, c) => placed(clip, "video", t + 1, c + 1)),
  );
  const soundIds = soundTracks.map(({ list }, t) =>
    list.map((clip, c) => placed(clip, "audio", t + 1, c + 1)),
  );
  /** Links between a clip's picture and its sound, so they move together. */
  const links = (clip: NleClip) => {
    const all = items.get(clip) ?? [];
    if (all.length < 2) return [];
    return all.map(
      (item) =>
        `<link><linkclipref>${item.id}</linkclipref><mediatype>${item.mediatype}</mediatype>` +
        `<trackindex>${item.track}</trackindex><clipindex>${item.index}</clipindex>` +
        `${item.mediatype === "audio" ? "<groupindex>1</groupindex>" : ""}</link>`,
    );
  };
  const track = (list: NleClip[], ids: string[], kind: "video" | "audio", channel = 1) => {
    const parts: string[] = [];
    for (const [k, clip] of list.entries()) {
      const nextDissolve = list[k + 1]?.dissolve;
      parts.push(dissolve(clip, kind));
      const inner =
        kind === "video"
          ? [...motion(clip), ...links(clip)]
          : [
              `<sourcetrack><mediatype>audio</mediatype><trackindex>${channel}</trackindex></sourcetrack>`,
              ...levels(clip),
              ...links(clip),
            ];
      parts.push(
        item(clip, ids[k] ?? "", inner, clip.dissolve?.before ?? 0, nextDissolve?.after ?? 0),
      );
    }
    return `<track>${parts.join("")}<enabled>TRUE</enabled><locked>FALSE</locked></track>`;
  };

  const format = `<format><samplecharacteristics>${rate(fps)}<width>${output.width}</width><height>${output.height}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance><colordepth>24</colordepth></samplecharacteristics></format>`;
  const video = nle.video.map((list, t) => track(list, videoIds[t] ?? [], "video")).join("");
  const audio = soundTracks
    .map(({ list, channel }, t) => track(list, soundIds[t] ?? [], "audio", channel))
    .join("");
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE xmeml>`,
    `<xmeml version="4">`,
    `<sequence id="sequence-1"><name>${xmlText(name)}</name><duration>${nle.frames}</duration>${rate(fps)}${timecode(fps)}`,
    `<media><video>${format}${video}</video>`,
    `<audio><numOutputChannels>2</numOutputChannels><format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></format>${audio}</audio></media>`,
    `</sequence>`,
    `</xmeml>`,
    "",
  ].join("\n");
}
