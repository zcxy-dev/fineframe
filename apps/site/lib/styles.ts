// Class lists more than one component sets, so the pages share one measure and one voice.

/** The sentence under a section's heading, in the colour its ground sets. */
export const SECTION_LEDE = "mt-4.5 max-w-[34em] text-[clamp(17px,1.3vw,19px)]";

/** A paper card on an inner page. */
export const CARD = "rounded-card bg-paper p-[clamp(24px,2.6vw,36px)]";

/** A card's heading. */
export const HEADING = "mb-4 text-[clamp(22px,2vw,28px)] leading-[1.2]";

/** Running text, at a readable measure. */
export const PROSE = "max-w-[40em] text-ink-2 [&+&]:mt-3";

/** A list with an amber cut mark for each item. */
export const LIST =
  "max-w-[40em] space-y-2.5 text-ink-2 [&>li]:relative [&>li]:pl-5.5 [&>li]:before:absolute [&>li]:before:top-[0.5em] [&>li]:before:left-0.5 [&>li]:before:h-[0.85em] [&>li]:before:w-[3px] [&>li]:before:rounded-full [&>li]:before:bg-amber";

/** A note: a status, or, with `ERROR`, what went wrong. */
export const NOTICE = "max-w-[40em] rounded-xl bg-ground px-4 py-3 text-[15px] text-ink-2";
export const ERROR = "border-(length:--stroke) border-cut bg-paper text-ink";

/** Small print beside a form. */
export const HINT = "text-sm text-ink-3";
