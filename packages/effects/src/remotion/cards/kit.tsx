// What every card shares: the lit dark canvas, glass panels, icons, the build clock and number
// formatting, so the cards read as one family and move on the overlays' curves.

import { type CSSProperties, createElement, type ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { ICONS, type IconName, LOGOS, type LogoName } from "../../icons.ts";
import { type CardLayout, COLORS, ems, MOTION, rgba } from "../../layout.ts";

const enter = Easing.bezier(...MOTION.enter);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Muted text and hairlines on the dark canvas. */
export const DIM = rgba(COLORS.paper, 0.64);
export const FAINT = rgba(COLORS.paper, 0.36);
export const LINE = rgba(COLORS.paper, 0.14);

/**
 * The card's clock. A card builds in over `natural` seconds and then holds until a hard cut
 * takes it away, so it has no exit. When the card is shorter, its build runs faster so that it
 * finishes by 60 % of the card's length. `at(from, seconds)` runs 0 to 1, eased, over a step of
 * the build; `linear(from, seconds)` does the same without easing, for typing and counting.
 */
export function useBuild(natural: number) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const length = durationInFrames / fps;
  const pace = Math.min(1, (0.6 * length) / natural);
  // A step of no length is a switch at its start.
  const span = (from: number, seconds: number) => [
    from * pace * fps,
    (from + Math.max(seconds, 1e-3)) * pace * fps,
  ];
  return {
    at: (from: number, seconds: number = MOTION.reveal) =>
      interpolate(frame, span(from, seconds), [0, 1], { ...clamp, easing: enter }),
    linear: (from: number, seconds: number) =>
      interpolate(frame, span(from, seconds), [0, 1], clamp),
    /** 0 to 1 over the whole card. */
    t: frame / Math.max(1, durationInFrames - 1),
    seconds: frame / fps,
  };
}

/** A reveal as it rises into place: faded, a little low and a little small at 0. */
export function rise(progress: number, u: number, distance = 3): CSSProperties {
  return {
    opacity: progress,
    transform: `translateY(${(1 - progress) * distance * u}px) scale(${0.96 + 0.04 * progress})`,
  };
}

/** The canvas every card stands on, filling the frame, with its content box laid over it. The
 * canvas drifts and the content pushes in by 2 % over the card, so a held card still moves. */
export function CardFrame(props: {
  layout: CardLayout;
  accent: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const { layout, accent } = props;
  const { t } = useBuild(1);
  const { box, u } = layout;
  const base = Math.min(layout.width, layout.height) / 100;
  // The bloom rises from just below the content, which on a full 9:16 card ends well above the
  // frame's bottom.
  const bloom = ((box.top + box.height * 1.1) / layout.height) * 100;
  return (
    <AbsoluteFill style={{ background: COLORS.ink, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          background: [
            `radial-gradient(ellipse 90% ${Math.min(60, (box.height / layout.height) * 80)}% at 50% ${bloom - 4 * t}%, ${rgba(accent, 0.26)}, ${rgba(accent, 0)} 70%)`,
            `radial-gradient(ellipse 70% 50% at 12% 0%, ${rgba("#3a5bd9", 0.16)}, rgba(0,0,0,0) 70%)`,
          ].join(", "),
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: `radial-gradient(${rgba(COLORS.paper, 0.09)} ${0.14 * base}px, transparent ${0.18 * base}px)`,
          backgroundSize: `${3.2 * base}px ${3.2 * base}px`,
          backgroundPosition: `${t * 1.6 * base}px ${t * 1.6 * base}px`,
          maskImage: "radial-gradient(ellipse 75% 70% at 50% 50%, #000 30%, transparent 85%)",
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 85% 85% at 50% 50%, rgba(0,0,0,0) 55%, ${rgba("#000000", 0.5)})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
          display: "flex",
          flexDirection: "column",
          gap: 4 * u,
          transform: `scale(${1 + 0.02 * t})`,
          ...props.style,
        }}
      >
        {props.children}
      </div>
    </AbsoluteFill>
  );
}

/** A frosted panel: a faint fill, a hairline edge, a lit top edge and a soft shadow. */
export function glass(u: number, lift = 1): CSSProperties {
  return {
    background: `linear-gradient(180deg, ${rgba(COLORS.paper, 0.09 * lift)}, ${rgba(COLORS.paper, 0.04 * lift)})`,
    border: `${Math.max(1, 0.18 * u)}px solid ${LINE}`,
    borderRadius: 2.6 * u,
    boxShadow: `0 ${1.6 * u}px ${5 * u}px ${rgba("#000000", 0.45)}, inset 0 ${Math.max(1, 0.18 * u)}px 0 ${rgba(COLORS.paper, 0.12)}`,
  };
}

/** A soft halo in the accent, for the one element each card makes the eye land on. */
export function glow(accent: string, u: number, strength = 1): string {
  return `0 0 ${2.4 * u}px ${rgba(accent, 0.55 * strength)}, 0 0 ${7 * u}px ${rgba(accent, 0.3 * strength)}`;
}

/** A card's heading at the top of its content box. */
export function Heading(props: { text?: string; layout: CardLayout; progress: number }) {
  if (!props.text) return null;
  const { u, type } = props.layout;
  return (
    <div
      style={{
        fontSize: type("heading"),
        fontWeight: 900,
        lineHeight: 1.15,
        letterSpacing: "0.01em",
        textWrap: "balance",
        flexShrink: 0,
        ...rise(props.progress, u),
      }}
    >
      {props.text}
    </div>
  );
}

/** A Lucide icon, stroked in `color`. */
export function Icon(props: { name: IconName; size: number; color?: string; stroke?: number }) {
  return (
    <svg
      width={props.size}
      height={props.size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={props.color ?? "currentColor"}
      strokeWidth={props.stroke ?? 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, display: "block" }}
      aria-hidden
    >
      {ICONS[props.name].map(([tag, attrs], i) => createElement(tag, { ...attrs, key: i }))}
    </svg>
  );
}

/** A brand logo from Simple Icons, filled in `color`. */
export function Logo(props: { name: LogoName; size: number; color?: string }) {
  return (
    <svg
      width={props.size}
      height={props.size}
      viewBox="0 0 24 24"
      fill={props.color ?? "currentColor"}
      style={{ flexShrink: 0, display: "block" }}
      aria-hidden
    >
      <path d={LOGOS[props.name].path} />
    </svg>
  );
}

/** A brand's colour where it shows on the dark canvas, else the accent: logos in black or near
 * black, like many tech brands', would vanish. */
export function brandColor(name: LogoName, accent: string): string {
  const n = Number.parseInt(LOGOS[name].hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 70 ? LOGOS[name].hex : accent;
}

/** A logo, else an icon, else nothing: the mark beside a name. */
export function Mark(props: { icon?: IconName; logo?: LogoName; size: number; color?: string }) {
  if (props.logo) return <Logo name={props.logo} size={props.size} color={props.color} />;
  if (props.icon) return <Icon name={props.icon} size={props.size} color={props.color} />;
  return null;
}

/** A mark on a rounded tile, lit from within in its colour. */
export function Tile(props: {
  icon?: IconName;
  logo?: LogoName;
  size: number;
  color: string;
  u: number;
}) {
  const { size, color, u } = props;
  return (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: size * 0.26,
        background: `radial-gradient(circle at 50% 30%, ${rgba(color, 0.32)}, ${rgba(color, 0.1)})`,
        border: `${Math.max(1, 0.18 * u)}px solid ${rgba(color, 0.5)}`,
        boxShadow: `0 0 ${3 * u}px ${rgba(color, 0.25)}`,
      }}
    >
      <Mark icon={props.icon} logo={props.logo} size={size * 0.54} color={COLORS.paper} />
    </div>
  );
}

/** `value` as the number a counter shows `progress` of the way up to it, with thousands
 * separators and `decimals` places. */
export function count(value: number, progress: number, decimals = 0): string {
  return (value * progress).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** The first `progress` of `text`, by character, for typing. */
export function typed(text: string, progress: number): string {
  const chars = [...text];
  return chars.slice(0, Math.round(chars.length * progress)).join("");
}

/** A blinking text cursor, on for half a second and off for the next. */
export function Caret(props: { seconds: number; color: string; height: number }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: props.height * 0.08,
        height: props.height,
        marginLeft: props.height * 0.08,
        verticalAlign: "text-bottom",
        background: props.color,
        opacity: Math.floor(props.seconds * 2) % 2 === 0 ? 1 : 0,
      }}
    />
  );
}

/** `text` with the spaces beside CJK made non-breaking, so that with `word-break: keep-all` a
 * line breaks after punctuation or between Latin words, never between "AI" and the 不會 after it. */
export function glue(text: string): string {
  return text.replace(/(?<=[\u2e80-\uffff]) | (?=[\u2e80-\uffff])/g, "\u00a0");
}

/** The type size, at most `max`, at which `text` wrapped to `width` pixels fits `height`. Blocks
 * set with it break CJK only at punctuation and spaces where they can (`word-break: keep-all`),
 * so a word such as 程式碼 stays whole. */
export function fitBlock(
  text: string,
  max: number,
  width: number,
  height: number,
  lineHeight = 1.3,
): number {
  const length = ems(text);
  // The longest run keep-all will not break: up to a space between Latin words or after CJK
  // punctuation.
  const runs = glue(text).split(/ +|(?<=[，。、！？；：」』）])/);
  const longest = Math.max(...runs.map(ems));
  let size = Math.min(max, (width * 0.98) / longest);
  // Wrapping at word and punctuation boundaries leaves each line a little short.
  while (size > 6 && Math.ceil((length * size * 1.1) / width) * lineHeight * size > height) {
    size *= 0.95;
  }
  return size;
}

/** The monospaced face of terminals and code, falling back to Noto Sans TC for CJK. */
export const MONO = "JetBrains Mono";
export const monoFamily = `"${MONO}", "Noto Sans TC", monospace`;
