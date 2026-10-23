// Class lists more than one component sets, so the panes share one measure and one voice.

export { cn } from "cn";

/** A pane section's heading: small caps in steel. Chinese has no capitals: it is set a little
 * larger and wider instead. Field labels are never set this way. */
export const SLUG =
  "text-[11px] leading-snug font-semibold tracking-[0.1em] text-steel uppercase lang-zh:text-xs lang-zh:tracking-[0.16em]";

/** A screen's title, lit word by word as it opens. */
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

/** Options joined as one segmented control; the chosen one is steel, never amber. */
export const SEGMENTS = "flex w-full gap-0.5 rounded-[10px] border bg-well p-0.5";
export const SEGMENT =
  "h-8 min-w-0 flex-auto rounded-lg px-2 text-[13px] font-medium whitespace-nowrap text-steel tabular-nums transition-[background-color,color,box-shadow] duration-150 hover:bg-white/5 hover:text-foreground focus-visible:outline-offset-0 aria-pressed:bg-raised aria-pressed:font-semibold aria-pressed:text-foreground aria-pressed:shadow-[inset_0_0_0_1px_var(--edge),0_1px_2px_rgb(0_0_0/0.4)]";

/** A card that shows a choice, such as an aspect or a caption style: the chosen one is framed in
 * steel and raised. */
export const CHOICE =
  "relative flex cursor-pointer flex-col items-center rounded-xl border bg-well transition-[border-color,background-color] duration-150 hover:border-edge has-checked:border-foreground/70 has-checked:bg-raised has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary aria-pressed:border-foreground/70 aria-pressed:bg-raised";

/** A radio read by assistive tech and the keyboard, while its card shows its state. */
export const HIDDEN_RADIO = "pointer-events-none absolute size-px opacity-0";

/** A checkbox and its words on one line. */
export const CHECK = "inline-flex items-center gap-2 text-[13px] text-steel [&>input]:size-3.5";

/** A list of rows divided by hairlines inside a framed well. */
export const LIST = "m-0 list-none divide-y overflow-hidden rounded-xl border bg-card p-0";

/** The sections of a docked panel, divided by hairlines. */
export const SECTION = "flex flex-col gap-3 px-6 py-5 max-md:px-4";

/** The square frame of a file's icon in a list. */
export const ICON_FRAME =
  "grid size-8 shrink-0 place-items-center rounded-lg border bg-well text-steel [&_svg]:size-4";
