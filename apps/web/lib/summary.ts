// What the done view's summary says of an edit: the version shown's own length, aspect, look,
// caption style and Claude cost, and the settings every version shares.
import type { ClaudeCost } from "@video-editor/schema";
import type { Job } from "./jobs.ts";
import { shownPlan } from "./paths.ts";
import { formatDollars, formatLength, type Style, styleName } from "./settings.ts";

/** What Claude cost in all; null when a price is unknown. */
export function dollarsOf(cost: ClaudeCost): number | null {
  const { plan, check } = cost;
  return plan.dollars === null || check.dollars === null ? null : plan.dollars + check.dollars;
}

/** The summary's rows, name and value, for the version shown. */
export function summaryRows(job: Job): [string, string][] {
  const shown = job.versions?.find((version) => version.n === (job.current ?? 1));
  const first = !shown || shown.n === 1;
  const { length, aspect } = shownPlan(job);
  const look = (shown?.look ?? job.settings.style) as Style;
  const captions = shown?.captions ?? job.settings.captions;
  const videos = job.files.filter((file) => file.use === "video").length;
  const photos = job.files.filter((file) => file.use === "image").length;
  const offered = job.files.filter((file) => file.use === "music").length;
  const rows: [string, string][] = [
    ["Length", formatLength(length)],
    ["Aspect", aspect],
    ["Style", styleName(look)],
    // Edits from before the setting had none.
    ...(captions ? [["Captions", styleName(captions as Style)] as [string, string]] : []),
    ["Speech", job.settings.asr === "cloud" ? "OpenRouter" : "On this computer"],
    ...(job.settings.visuals
      ? [["Visuals", job.settings.visuals === "rich" ? "Rich" : "Minimal"] as [string, string]]
      : []),
    [
      "Footage",
      `${videos} ${videos === 1 ? "video" : "videos"}${photos ? `, ${photos} ${photos === 1 ? "photo" : "photos"}` : ""}`,
    ],
  ];
  if (offered > 0) {
    // Claude picks one of the tracks offered, or none; the page knows which once it is done.
    const played = job.result?.music;
    rows.push([
      "Music",
      played
        ? played.length > 0
          ? played.map((path) => path.split("/").at(-1)).join(", ")
          : "None chosen"
        : `${offered} ${offered === 1 ? "track" : "tracks"} offered`,
    ]);
  }
  if (job.settings.names.length > 0) {
    // Edits from before terms had their own list counted both here.
    rows.push([
      job.settings.terms ? "Names" : "Names and terms",
      String(job.settings.names.length),
    ]);
  }
  if (job.settings.terms?.length) rows.push(["Terms", String(job.settings.terms.length)]);
  // A re-plan's instructions are named in its version's summary instead.
  if (first && job.settings.instructions) rows.push(["Planned", "With instructions"]);
  // What this version cost: the edit's plan, a re-plan's, or nothing for a change made without
  // one.
  const cost = first ? job.claude : shown?.claude;
  if (cost) {
    rows.push(["Claude, planning", formatDollars(cost.plan.dollars)]);
    rows.push(["Claude, checking cuts", formatDollars(cost.check.dollars)]);
  } else if (!first) {
    rows.push(["Claude", "None: changed without a new plan"]);
  }
  const costs = [job.claude, ...(job.versions ?? []).map((version) => version.claude)].filter(
    (each): each is ClaudeCost => each !== undefined,
  );
  if ((job.versions?.length ?? 0) > 1 && costs.length > 0) {
    const each = costs.map(dollarsOf);
    const total = each.includes(null)
      ? null
      : each.reduce<number>((sum, dollars) => sum + (dollars ?? 0), 0);
    rows.push(["Claude, all versions in total", formatDollars(total)]);
  }
  return rows;
}
