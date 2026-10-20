// The credits of the B-roll a video shows, written beside it as `<name>.broll.txt`, as the
// music's licences go to `<name>.music.txt`: ready to paste under the video.
import { writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { LOGOS, marksIn } from "@video-editor/effects";

/** Where one piece of B-roll came from and what its source asks to be credited. */
export interface Credit {
  /** What it is, such as "Video by Jane Doe on Pexels" or "Screenshot of example.com". */
  what: string;
  /** The page it came from, linked back to as the source's terms ask. */
  source: string;
  /** The licence it is used under, with where its terms are; null for a screenshot, whose page
   * keeps its owner's rights. */
  license: { name: string; url: string } | null;
  /** Who made it, when the source names them. */
  by: { name: string; url: string | null } | null;
  /** A note the credit must carry, such as a trademark's. */
  note?: string;
}

/** The credits as text, once per source, in the order given. */
export function creditText(video: string, credits: readonly Credit[]): string {
  const lines = [`B-roll in ${video}, with where each piece came from.`];
  const seen = new Set<string>();
  for (const credit of credits) {
    if (seen.has(credit.source)) continue;
    seen.add(credit.source);
    lines.push("", credit.what, `  Source: ${credit.source}`);
    if (credit.by)
      lines.push(`  By: ${credit.by.name}${credit.by.url ? ` (${credit.by.url})` : ""}`);
    if (credit.license) lines.push(`  Licence: ${credit.license.name} (${credit.license.url})`);
    if (credit.note) lines.push(`  Note: ${credit.note}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Writes the credits to `<name>.broll.txt` beside `video` and returns its path. */
export async function writeCredits(video: string, credits: readonly Credit[]): Promise<string> {
  const path = `${video.replace(/\.[^./\\]+$/, "")}.broll.txt`;
  await writeFile(path, creditText(basename(video), credits));
  return path;
}

/** The credits of the icons and logos a graphic's markup shows, from the sets bundled with it. */
export function markCredits(html: string): Credit[] {
  const { icons, logos } = marksIn(html);
  return [
    ...logos.map((name) => {
      const { title } = LOGOS[name];
      return {
        what: `${title} logo, from Simple Icons`,
        source: `https://simpleicons.org/?q=${encodeURIComponent(name)}`,
        license: { name: "CC0-1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/" },
        by: null,
        note: `${title} is a trademark of its owner: show it only to refer to ${title}.`,
      };
    }),
    ...icons.map((name) => ({
      what: `Lucide icon "${name}"`,
      source: `https://lucide.dev/icons/${name}`,
      license: { name: "ISC", url: "https://github.com/lucide-icons/lucide/blob/main/LICENSE" },
      by: null,
    })),
  ];
}
