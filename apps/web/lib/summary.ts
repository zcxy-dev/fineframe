// What the done view's summary says of an edit: the version shown's own length, aspect, look,
// caption style and Claude cost, and the settings every version shares.
import type { ClaudeCost } from "@video-editor/schema";
import { en, type Messages } from "./i18n/en.ts";
import type { Job } from "./jobs.ts";
import { shownPlan } from "./paths.ts";
import {
  captionStyleName,
  formatClock,
  formatDollars,
  formatLength,
  formatRange,
  type Style,
  styleName,
} from "./settings.ts";

/** What Claude cost in all; null when a price is unknown. Edits from before graphics had none. */
export function dollarsOf(cost: ClaudeCost): number | null {
  const none = { dollars: 0 };
  const parts = [cost.find ?? none, cost.plan, cost.graphics ?? none, cost.check].map(
    (s) => s.dollars,
  );
  return parts.includes(null) ? null : parts.reduce<number>((sum, d) => sum + (d ?? 0), 0);
}

/** The summary's rows, name and value in `t`'s words, for the version shown, whose video is
 * `actual` seconds long once the page knows. */
export function summaryRows(
  job: Job,
  actual?: number | null,
  t: Messages = en,
): [string, string][] {
  const words = t.summary;
  const shown = job.versions?.find((version) => version.n === (job.current ?? 1));
  const first = !shown || shown.n === 1;
  const { length, aspect } = shownPlan(job);
  const look = (shown?.look ?? job.settings.style) as Style;
  const captions = shown?.captions ?? job.settings.captions;
  const brand = shown?.brand !== undefined ? shown.brand : (job.settings.brand?.name ?? null);
  const videos = job.files.filter((file) => file.use === "video").length;
  const photos = job.files.filter((file) => file.use === "image").length;
  const offered = job.files.filter((file) => file.use === "music").length;
  const { shorts } = job.settings;
  const rows: [string, string][] = [
    [
      words.length,
      // The run of shorts, rather than one of them: the range each lies in.
      shorts && !job.short
        ? words.each(formatRange(shorts.min, shorts.max, t))
        : `${words.target(formatLength(length, t))}${actual ? words.actual(formatClock(actual)) : ""}`,
    ],
    [words.aspect, aspect],
    [words.style, styleName(look, t)],
    // Edits from before the setting had none.
    ...(captions ? [[words.captions, captionStyleName(captions, t)] as [string, string]] : []),
    ...(brand ? [[words.brand, brand] as [string, string]] : []),
    [words.speech, job.settings.asr === "cloud" ? "OpenRouter" : words.local],
    ...(job.settings.visuals
      ? [[words.visuals, t.settings.visualsChoices[job.settings.visuals].name] as [string, string]]
      : []),
    [
      words.footage,
      `${t.footage.videos(videos)}${photos ? `${t.list}${t.footage.photos(photos)}` : ""}`,
    ],
  ];
  // Claude picks one of the tracks offered, or of the library's, or none; the page knows which
  // once it is done.
  const played = job.result?.music;
  if (offered > 0 || played?.length) {
    rows.push([
      words.music,
      played
        ? played.length > 0
          ? played.map((path) => path.split("/").at(-1)).join(t.list)
          : words.noMusic
        : words.offered(offered),
    ]);
  }
  if (job.settings.names.length > 0) {
    // Edits from before terms had their own list counted both here.
    rows.push([
      job.settings.terms ? words.names : words.namesAndTerms,
      String(job.settings.names.length),
    ]);
  }
  if (job.settings.terms?.length) rows.push([words.terms, String(job.settings.terms.length)]);
  // A re-plan's instructions are named in its version's summary instead.
  if (first && job.settings.instructions) rows.push([words.planned, words.withInstructions]);
  // What this version cost: the edit's plan, a re-plan's, or nothing for a change made without
  // one.
  const cost = first ? job.claude : shown?.claude;
  if (cost) {
    if (cost.find) rows.push([words.finding, formatDollars(cost.find.dollars, t)]);
    rows.push([words.planning, formatDollars(cost.plan.dollars, t)]);
    if (cost.graphics) rows.push([words.graphics, formatDollars(cost.graphics.dollars, t)]);
    rows.push([words.checking, formatDollars(cost.check.dollars, t)]);
  } else if (!first) {
    rows.push([words.claude, words.noPlan]);
  }
  const costs = [job.claude, ...(job.versions ?? []).map((version) => version.claude)].filter(
    (each): each is ClaudeCost => each !== undefined,
  );
  if ((job.versions?.length ?? 0) > 1 && costs.length > 0) {
    const each = costs.map(dollarsOf);
    const total = each.includes(null)
      ? null
      : each.reduce<number>((sum, dollars) => sum + (dollars ?? 0), 0);
    rows.push([words.total, formatDollars(total, t)]);
  }
  return rows;
}
