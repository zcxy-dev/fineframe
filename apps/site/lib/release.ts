import { DOWNLOADS } from "./site.ts";

/** The released app's version and when it was released, as its update feed says. */
export type Release = { version: string; date: Date };

/** The version and the release date in an update feed (`latest-mac.yml`), if it names both. */
export function parseFeed(yml: string): Release | undefined {
  const version = /^version: *['"]?([\w.-]+)['"]? *$/m.exec(yml)?.[1];
  const released = /^releaseDate: *['"]?([^'"\n]+)['"]? *$/m.exec(yml)?.[1];
  const date = released ? new Date(released) : undefined;
  if (!version || !date || Number.isNaN(date.getTime())) return undefined;
  return { version, date };
}

/**
 * The released version, read from the update feed once, when the site is built: a release
 * builds the site again (`desktop.yml`), so the page names it. Without the feed (no
 * network, no release yet) the page names none.
 */
export async function latestRelease(): Promise<Release | undefined> {
  try {
    const response = await fetch(`${DOWNLOADS}/latest-mac.yml`);
    return response.ok ? parseFeed(await response.text()) : undefined;
  } catch {
    return undefined;
  }
}
