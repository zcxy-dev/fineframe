// The house look every effect is drawn in, as one stylesheet: near-black stages lit by a soft
// amber bloom, frosted glass panels with a thin light edge, white bold type and one amber accent.
// Its fonts are Noto Sans TC for Chinese and Inter for Latin letters and digits, both from
// Fontsource at pinned versions, so a frame never depends on the fonts on the machine.

import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/** The palette, from the app's own colours. */
export const PALETTE = {
  ink: "#0b0c0f",
  text: "#f5f6f8",
  muted: "#a9adb5",
  accent: "#ffb547",
  accentDeep: "#e8941f",
  accentSoft: "#ffd48a",
  good: "#7bc29a",
  bad: "#e0807a",
} as const;

/** The classes graphics are written with. `--u` is 1 % of the frame's short side. */
export const HOUSE_CSS = `:root {
  --ink: ${PALETTE.ink};
  --text: ${PALETTE.text};
  --muted: ${PALETTE.muted};
  --line: rgba(255, 255, 255, 0.14);
  --accent: ${PALETTE.accent};
  --accent-deep: ${PALETTE.accentDeep};
  --accent-soft: ${PALETTE.accentSoft};
  --good: ${PALETTE.good};
  --bad: ${PALETTE.bad};
  --enter: cubic-bezier(0.16, 1, 0.3, 1);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { overflow: hidden; background: transparent; }
.ff, .ff * {
  font-family: "Inter Variable", "Noto Sans TC", sans-serif;
  color: var(--text);
  font-weight: 800;
  letter-spacing: -0.01em;
  line-height: 1.15;
  -webkit-font-smoothing: antialiased;
}
.ff-stage {
  position: absolute; inset: 0; overflow: hidden;
  background:
    radial-gradient(ellipse 75% 55% at 50% 40%, rgba(255, 181, 71, 0.16), transparent 70%),
    radial-gradient(ellipse 60% 45% at 90% 105%, rgba(232, 148, 31, 0.12), transparent 70%),
    var(--ink);
}
.ff-stage::before {
  content: ""; position: absolute; inset: 0;
  background:
    repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.035) 0 1px, transparent 1px calc(var(--u) * 6)),
    repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.035) 0 1px, transparent 1px calc(var(--u) * 6));
  -webkit-mask-image: radial-gradient(ellipse at 50% 45%, #000 25%, transparent 80%);
}
.ff-stage::after {
  content: ""; position: absolute; inset: 0;
  background: radial-gradient(ellipse at center, transparent 45%, rgba(0, 0, 0, 0.55) 100%);
}
.ff-glass {
  position: relative;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.09), rgba(255, 255, 255, 0.03) 40%,
    rgba(255, 255, 255, 0.012) 60%, rgba(255, 255, 255, 0.06));
  border: 1px solid var(--line);
  border-radius: calc(var(--u) * 3);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22), 0 calc(var(--u) * 2) calc(var(--u) * 6) rgba(0, 0, 0, 0.45);
}
.ff-lit {
  border-color: rgba(255, 181, 71, 0.65);
  box-shadow: inset 0 1px 0 rgba(255, 220, 160, 0.35), 0 0 calc(var(--u) * 5) rgba(255, 181, 71, 0.28),
    0 calc(var(--u) * 2) calc(var(--u) * 6) rgba(0, 0, 0, 0.45);
}
.ff-chip {
  display: inline-flex; align-items: center; gap: calc(var(--u) * 1.6);
  padding: calc(var(--u) * 1.3) calc(var(--u) * 2.6);
  border-radius: 999px;
  background: rgba(13, 14, 17, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.16);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16), 0 0 calc(var(--u) * 4) rgba(255, 181, 71, 0.16),
    0 calc(var(--u) * 1) calc(var(--u) * 3) rgba(0, 0, 0, 0.35);
}
.ff-dot {
  width: calc(var(--u) * 1.5); height: calc(var(--u) * 1.5); border-radius: 50%; flex: none;
  background: var(--accent); box-shadow: 0 0 calc(var(--u) * 1.6) rgba(255, 181, 71, 0.9);
}
.ff-bar {
  width: calc(var(--u) * 1.1); align-self: stretch; border-radius: 99px; flex: none;
  background: var(--accent); box-shadow: 0 0 calc(var(--u) * 1.6) rgba(255, 181, 71, 0.8);
}
.ff-accent { color: var(--accent); }
.ff-muted { color: var(--muted); font-weight: 700; }
.ff-kicker { font-size: calc(var(--u) * 2.8); letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); }
.ff-hero { text-shadow: 0 0 calc(var(--u) * 3) rgba(255, 181, 71, 0.35); }
.ff-num { font-variant-numeric: tabular-nums; }
@keyframes ff-rise { from { opacity: 0; transform: translateY(calc(var(--u) * 4)); filter: blur(12px); } }
@keyframes ff-fade { from { opacity: 0; filter: blur(10px); } }
@keyframes ff-from-left { from { opacity: 0; transform: translateX(calc(var(--u) * -6)); filter: blur(12px); } }
@keyframes ff-from-right { from { opacity: 0; transform: translateX(calc(var(--u) * 6)); filter: blur(12px); } }
@keyframes ff-pop { from { opacity: 0; transform: scale(0.7); filter: blur(10px); } }
@keyframes ff-draw { from { transform: scaleX(0); } }
`;

/** A Fontsource stylesheet with its relative `url(./files/…)` turned to `files/…` and only the
 * WOFF2 sources kept, and `font-display: block`, so no frame is drawn in a fallback face. */
function faces(css: string): string {
  return css
    .replace(/, url\([^)]*\.woff\) format\('woff'\)/g, "")
    .replaceAll("url(./files/", "url(files/")
    .replaceAll("font-display: swap", "font-display: block");
}

/** The font stylesheet and each font file it names, by its name in `files/`. */
export async function fontAssets(
  read: (path: string) => Promise<string>,
): Promise<{ css: string; files: Map<string, string> }> {
  const noto = dirname(require.resolve("@fontsource/noto-sans-tc/700.css"));
  const inter = dirname(require.resolve("@fontsource-variable/inter/wght.css"));
  const sheets = [
    [noto, "700.css"],
    [noto, "900.css"],
    [inter, "wght.css"],
  ] as const;
  let css = "";
  const files = new Map<string, string>();
  for (const [dir, sheet] of sheets) {
    const own = faces(await read(join(dir, sheet)));
    // Inter covers Latin and digits; its other scripts are left to Noto Sans TC.
    const kept =
      dir === inter
        ? own
            .split(/(?=\/\* )/)
            .filter((block) => /inter-latin(-ext)?-wght-normal/.test(block))
            .join("")
        : own;
    css += kept;
    for (const [, name] of kept.matchAll(/url\(files\/([^)]+\.woff2)\)/g)) {
      files.set(name as string, join(dir, "files", name as string));
    }
  }
  return { css, files };
}
