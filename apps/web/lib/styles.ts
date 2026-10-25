// Class lists more than one component sets, so the panes share one measure and one voice.

export { cn } from "cn";

/** A pane section's heading: small caps in ink grey. Chinese has no capitals: it is set a little
 * larger and wider instead. Field labels are never set this way. */
export const SLUG =
  "text-[11px] leading-snug font-semibold tracking-[0.1em] text-steel uppercase lang-zh:text-xs lang-zh:tracking-[0.16em]";

/** A screen's title. */
export const TITLE = "display text-[clamp(26px,2.6vw,36px)] leading-[1.08]";

/** A panel's title. */
export const PANEL_TITLE = "display text-2xl leading-tight";

/** A field's label, in sentence case. */
export const LABEL =
  "flex w-full items-baseline justify-between gap-2 p-0 text-[13px] leading-snug font-semibold text-foreground";

/** What follows a label on its right: optional, a range. */
export const LABEL_HINT = "text-xs font-normal text-muted-foreground tabular-nums";

/** Small print under a control. */
export const HELP = "text-xs leading-relaxed text-muted-foreground";

/** A note to act on, in a hairline frame. */
export const WARNING =
  "rounded-lg border border-edge bg-well px-3 py-2 text-xs leading-relaxed text-foreground";

/** Data: lengths, sizes, times and costs. */
export const META = "text-xs text-muted-foreground tabular-nums";

/** Options as a row of pills; the chosen one is filled in ink, never amber. */
export const SEGMENTS = "flex w-full flex-wrap gap-1.5";
export const SEGMENT =
  "h-8 min-w-0 rounded-full border-(length:--stroke) border-border bg-card px-3.5 text-[13px] font-medium whitespace-nowrap text-foreground tabular-nums transition-[background-color,border-color,color] duration-150 hover:border-foreground/40 aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:font-semibold aria-pressed:text-background";

/** A card that shows a choice, such as an aspect or a caption style: the chosen one is framed in
 * ink. */
export const CHOICE =
  "relative flex cursor-pointer flex-col items-center rounded-xl border-(length:--stroke) border-border bg-card transition-[border-color,box-shadow] duration-150 hover:border-foreground/40 has-checked:border-foreground has-checked:shadow-[inset_0_0_0_1px_var(--foreground)] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring aria-pressed:border-foreground aria-pressed:shadow-[inset_0_0_0_1px_var(--foreground)]";

/** A radio read by assistive tech and the keyboard, while its card shows its state. */
export const HIDDEN_RADIO = "pointer-events-none absolute size-px opacity-0";

/** A checkbox and its words on one line. */
export const CHECK = "inline-flex items-center gap-2 text-[13px] text-steel [&>input]:size-3.5";

/** A list of rows divided by hairlines inside a framed well. */
export const LIST = "m-0 list-none divide-y overflow-hidden rounded-xl border bg-card p-0";

/** The sections of a docked panel, divided by hairlines. */
export const SECTION = "flex flex-col gap-3 px-6 py-5 max-md:px-4";
