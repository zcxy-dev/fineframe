// Class lists more than one component sets, so the pages share one measure and one voice. The
// scales they draw on are in app/globals.css and DESIGN.md.

/**
 * A micro-label: what a block is, in small capitals. Chinese has no capitals, so it is set a
 * little larger and wider instead. It names a block that has no heading of its own, or the
 * section a heading opens; it never repeats the heading under it. Its colour is the ground's
 * small print: ink-3 on light, on-dark-2 on graphite, amber-ink on amber.
 */
export const SLUG = "text-slug font-semibold tracking-slug uppercase";

/** A slug that opens a section, after an amber dot. */
export const EYEBROW = `${SLUG} flex items-center gap-2 text-ink-3 before:size-1.5 before:shrink-0 before:rounded-full before:bg-amber`;

/** The sentence under a section's heading, in the colour its ground sets. */
export const SECTION_LEDE = "mt-4 max-w-[34em] text-lede";

/** A paper card: a hairline edge and a shadow that only just lifts it. */
export const CARD = "rounded-card border bg-paper p-card shadow-card";

/** A card's heading. */
export const HEADING = "mb-4 text-subhead";

/** Running text, at a readable measure. */
export const PROSE = "max-w-[40em] text-ink-2 [&+&]:mt-3";

/** A list with an amber cut mark for each item. */
export const LIST =
  "max-w-[40em] space-y-2.5 text-ink-2 [&>li]:relative [&>li]:pl-5.5 [&>li]:before:absolute [&>li]:before:top-[0.5em] [&>li]:before:left-0.5 [&>li]:before:h-[0.85em] [&>li]:before:w-[3px] [&>li]:before:rounded-full [&>li]:before:bg-amber";

/** A note: a status, or, with `ERROR`, what went wrong. */
export const NOTICE = "max-w-[40em] rounded-frame bg-ground px-4 py-3 text-small text-ink-2";
export const ERROR = "border-(length:--stroke) border-cut bg-paper text-ink";

/** Small print beside a form. */
export const HINT = "text-fine text-ink-3";

/** A card that stands off the ground: a form on its own, or a plan. Used with `CARD`. */
export const RAISED = "shadow-raised";
