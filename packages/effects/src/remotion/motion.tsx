// The shared clock and reveal mask, so every template moves on the same curves and timings.

import type { CSSProperties, ReactNode } from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { MOTION } from "../layout.ts";

const enter = Easing.bezier(...MOTION.enter);
const leave = Easing.bezier(...MOTION.leave);
export const sweep = Easing.bezier(...MOTION.sweep);

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/**
 * The overlay's clock. `enter(from, seconds)` runs 0 to 1 over an entrance that starts `from`
 * seconds in; `exit` runs 0 to 1 over the last MOTION.exit seconds, reaching 1 on the last frame;
 * `t` runs 0 to 1 over the whole overlay. The first frame is before every entrance and the last
 * after the exit, so an overlay neither pops in nor out.
 */
export function useMotion() {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const last = Math.max(1, durationInFrames - 1);
  return {
    enter: (from: number, seconds: number) =>
      interpolate(frame, [from * fps, (from + seconds) * fps], [0, 1], { ...clamp, easing: enter }),
    exit: interpolate(frame, [last - MOTION.exit * fps, last], [0, 1], { ...clamp, easing: leave }),
    t: frame / last,
  };
}

/** Content that rises into view from behind a mask at its own bottom edge as `progress` goes
 * from 0 to 1. */
export function Rise(props: { progress: number; style?: CSSProperties; children: ReactNode }) {
  return (
    // Padding keeps descenders and accents inside the mask; the margin gives the space back.
    <div
      style={{
        overflow: "hidden",
        padding: "0.12em 0.1em",
        margin: "-0.12em -0.1em",
        ...props.style,
      }}
    >
      <div style={{ transform: `translateY(${(1 - props.progress) * 110}%)` }}>
        {props.children}
      </div>
    </div>
  );
}
