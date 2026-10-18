import type { CSSProperties } from "react";

/**
 * A highlighter mark `swept` 0 to 1 across its phrase. The phrase's text keeps the place it has in
 * plain text: the box is a layer behind it, a little wider than the phrase, that takes no room,
 * so the text before and after the mark stays put from the first frame. Its block must isolate,
 * so the box sits behind the text and over nothing else.
 */
export function markStyle(
  swept: number,
  accent: string,
): { text: CSSProperties; box: CSSProperties } {
  return {
    text: { position: "relative" },
    box: {
      position: "absolute",
      zIndex: -1,
      top: 0,
      bottom: 0,
      left: "-0.08em",
      right: "-0.08em",
      borderRadius: "0.12em",
      background: accent,
      clipPath: `inset(0 ${(1 - swept) * 100}% 0 0)`,
    },
  };
}
