// A small set of quiet sound effects, all CC0, for visible actions only: soft taps, dry clicks,
// paper and air, never a whoosh on every cut. Several files per kind, so a list of items does not
// sound like a loop. Most are from Kenney's audio packs; the air and the warm tones are drawn by
// scripts/sfx.ts.
import { fileURLToPath } from "node:url";

/** What a sound is for. */
export type SfxKind =
  /** A dry click, for small UI: a button, a cursor, a toggle. */
  | "click"
  /** A damped tap, for something landing: a logo, a card, a number. */
  | "tap"
  /** Paper, for a document, a page or a list. */
  | "paper"
  /** Air, only for a real move across the frame. */
  | "whoosh"
  /** One short warm tone, for a check or a success. */
  | "tone"
  /** A dry stop, for an X or a wrong way. */
  | "stop";

export interface Sfx {
  kind: SfxKind;
  /** The file, an Ogg Vorbis. */
  path: string;
  /** Where it came from. */
  source: string;
}

const KENNEY = {
  interface: "Kenney, Interface Sounds 1.0 (https://kenney.nl/assets/interface-sounds)",
  ui: "Kenney, UI Audio (https://kenney.nl/assets/ui-audio)",
  impact: "Kenney, Impact Sounds 1.0 (https://kenney.nl/assets/impact-sounds)",
  casino: "Kenney, Casino Audio (https://kenney.nl/assets/casino-audio)",
  rpg: "Kenney, RPG Audio (https://kenney.nl/assets/rpg-audio)",
  own: "this project (scripts/sfx.ts)",
};

/** Every file, by kind, with its source; all are CC0 1.0. */
const FILES: Record<SfxKind, [string, string][]> = {
  click: [
    ["click_001.ogg", KENNEY.interface],
    ["click_002.ogg", KENNEY.interface],
    ["click_005.ogg", KENNEY.interface],
    ["click2.ogg", KENNEY.ui],
  ],
  tap: [
    ["impactSoft_medium_000.ogg", KENNEY.impact],
    ["impactSoft_medium_001.ogg", KENNEY.impact],
    ["impactSoft_medium_002.ogg", KENNEY.impact],
    ["impactWood_light_002.ogg", KENNEY.impact],
  ],
  paper: [
    ["card-slide-1.ogg", KENNEY.casino],
    ["card-slide-5.ogg", KENNEY.casino],
    ["card-place-1.ogg", KENNEY.casino],
    ["bookFlip3.ogg", KENNEY.rpg],
  ],
  whoosh: [
    ["air-1.ogg", KENNEY.own],
    ["air-2.ogg", KENNEY.own],
    ["air-3.ogg", KENNEY.own],
  ],
  tone: [
    ["warm-1.ogg", KENNEY.own],
    ["warm-2.ogg", KENNEY.own],
    ["pluck_001.ogg", KENNEY.interface],
    ["pluck_002.ogg", KENNEY.interface],
  ],
  stop: [
    ["back_002.ogg", KENNEY.interface],
    ["back_004.ogg", KENNEY.interface],
    ["impactGeneric_light_002.ogg", KENNEY.impact],
  ],
};

export const SFX_KINDS = Object.keys(FILES) as SfxKind[];

/** The licence every sound effect is under. */
export const SFX_LICENSE = {
  name: "CC0 1.0",
  url: "https://creativecommons.org/publicdomain/zero/1.0/",
};

/** Every sound of `kind`. */
export function sfxOf(kind: SfxKind): Sfx[] {
  return FILES[kind].map(([file, source]) => ({
    kind,
    path: fileURLToPath(new URL(`../../assets/sfx/${kind}/${file}`, import.meta.url)),
    source,
  }));
}

/** The `nth` use of `kind` in a video: each use takes the next file, so repeats vary. */
export function pickSfx(kind: SfxKind, nth: number): Sfx {
  const all = sfxOf(kind);
  return all[((nth % all.length) + all.length) % all.length] as Sfx;
}
