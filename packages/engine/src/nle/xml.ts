// What both timeline files share: XML text, file URLs and rational times.

import { type FrameRate, TICKS_PER_SECOND } from "@video-editor/schema";

/** Text or an attribute value as XML writes it. */
export function xmlText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** Each path segment percent-encoded as UTF-8, as RFC 3986 asks: spaces, Chinese and the
 * characters URLs reserve, keeping a Windows drive's colon. */
function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) =>
      /^[A-Za-z]:$/.test(segment)
        ? segment
        : encodeURIComponent(segment).replace(
            /[!'()*]/g,
            (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
          ),
    )
    .join("/");
}

/**
 * A file URL for an absolute path on macOS, Linux or Windows: `file:///Users/…`,
 * `file:///C:/Users/…`, with a Windows share as `file://server/share/…`. `localhost` names the
 * host as Final Cut Pro 7 XML writes it, which Premiere expects.
 */
export function fileUrl(path: string, host = ""): string {
  const slashed = path.replaceAll("\\", "/");
  if (slashed.startsWith("//")) return `file:${encodePath(slashed)}`;
  const rooted = slashed.startsWith("/") ? slashed : `/${slashed}`;
  return `file://${host}${encodePath(rooted)}`;
}

/** A relative path as a URL reference, resolved against the timeline file's folder. */
export function relativeUrl(path: string): string {
  return encodePath(path);
}

/** Ticks as FCPXML's rational seconds, reduced: `1001/30000s`, `5s`, `0s`. */
export function rational(ticks: number): string {
  if (ticks === 0) return "0s";
  const d = gcd(Math.abs(ticks), TICKS_PER_SECOND);
  const num = ticks / d;
  const den = TICKS_PER_SECOND / d;
  return den === 1 ? `${num}s` : `${num}/${den}s`;
}

/** Whole frames at `fps` as rational seconds over the rate's own denominator, as Final Cut
 * writes them: `3003/24000s` for three frames at 23.976 fps. */
export function frames(count: number, fps: FrameRate): string {
  return count === 0 ? "0s" : `${count * fps.den}/${fps.num}s`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
