"use client";

import { rgba } from "@video-editor/effects/layout";
import { type CaptionStyle, PRESETS, type Preset } from "@video-editor/engine/captions";
import type { CSSProperties } from "react";
import { useT } from "./I18n.tsx";

/**
 * A caption style over a dark frame, in a 2.4 s loop of four sample words said 0.45 s apart: an
 * approximation of what libass draws, from the preset's own values, to choose by. The motion is
 * in app/globals.css; with reduced motion it holds one frame. A brand kit's captions give their own
 * preset and the family their face is loaded as.
 */
export function CaptionPreview({
  style,
  preset: own,
  font,
}: {
  style: CaptionStyle;
  preset?: Preset;
  font?: string;
}) {
  const { sample, sampleGap } = useT().settings;
  if (style === "none") {
    return <span className="caption-frame" data-style={style} aria-hidden="true" />;
  }
  const preset = own ?? PRESETS[style];
  const em = (value: number) => `${value}em`;
  const text: CSSProperties = {
    ...(font ? { fontFamily: `${font}, var(--font-sans)` } : {}),
    color: preset.text,
    fontWeight: preset.weight,
    fontSize: em(preset.scale),
    letterSpacing: em(preset.tracking),
    ...(preset.shadow
      ? {
          textShadow: `0 ${em(preset.shadow.offset)} ${em(preset.shadow.blur)} ${rgba(preset.shadow.color, preset.shadow.opacity)}`,
        }
      : {}),
    // A stroke drawn under the fill, as libass draws its border outside the glyph.
    ...(preset.stroke
      ? {
          WebkitTextStroke: `${em(preset.stroke.width * 2)} ${preset.stroke.color}`,
          paintOrder: "stroke fill",
        }
      : {}),
  };
  const plate: CSSProperties = preset.plate
    ? {
        background: rgba(preset.plate.color, preset.plate.opacity),
        padding: `${em(preset.plate.padY)} ${em(preset.plate.padX)}`,
        borderRadius: em(preset.plate.radius),
      }
    : {};
  const vars = { "--text": preset.text, "--active": preset.active } as CSSProperties;
  const word = (value: string, i: number, lead: boolean) => (
    <span
      key={i}
      className="caption-word"
      data-i={i}
      // Numbers are keywords, in the keyword colour, as the engine marks them.
      style={preset.keyword && /\d/.test(value) ? { color: preset.keyword } : undefined}
    >
      {lead ? sampleGap : ""}
      {value}
    </span>
  );
  return (
    <span className="caption-frame" data-style={style} style={vars} aria-hidden="true">
      {preset.chunk ? (
        // Two captions of two words each, one after the other.
        [0, 2].map((first) => (
          <span key={first} className="caption-chunk" data-i={first} style={{ ...text, ...plate }}>
            {sample.slice(first, first + 2).map((value, k) => word(value, first + k, k > 0))}
          </span>
        ))
      ) : (
        <span className="caption-text" style={text}>
          {sample.map((value, i) => word(value, i, i > 0))}
        </span>
      )}
    </span>
  );
}
