import type { FrameRate } from "./generated/project.ts";

/** A frame at 24, 25, 30, 48, 50, 60 or 120 fps, or at the NTSC rates (24, 30 or 60 × 1000/1001),
 * lasts a whole number of these ticks, so frame times never accumulate rounding error. */
export const TICKS_PER_SECOND = 120_000;

/** How a time between two frame starts picks a frame:
 * - floor: the frame on screen at that time;
 * - ceil: the first frame that starts at or after it;
 * - round: the nearest frame start, the later one on a tie. */
export type Rounding = "floor" | "ceil" | "round";

/** Seconds to the nearest tick, halves away from zero. */
export function secondsToTicks(seconds: number): number {
  const scaled = seconds * TICKS_PER_SECOND;
  const rounded = Math.round(Math.abs(scaled));
  return integer(scaled < 0 && rounded > 0 ? -rounded : rounded, `${seconds} s in ticks`);
}

export function ticksToSeconds(ticks: number): number {
  return integer(ticks, `${ticks} ticks`) / TICKS_PER_SECOND;
}

/** Fails for a rate whose frames are not a whole number of ticks long, such as 7/3 fps. */
export function ticksPerFrame(fps: FrameRate): number {
  const { num, den } = fps;
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || num < 1 || den < 1) {
    throw new RangeError(`${num}/${den} fps is not a frame rate`);
  }
  const ticks = TICKS_PER_SECOND * den;
  if (ticks % num !== 0) {
    throw new RangeError(`a frame at ${num}/${den} fps is not a whole number of ticks`);
  }
  return ticks / num;
}

/** When a frame starts. */
export function frameToTicks(frame: number, fps: FrameRate): number {
  return integer(integer(frame, `frame ${frame}`) * ticksPerFrame(fps), `frame ${frame} in ticks`);
}

export function ticksToFrame(ticks: number, fps: FrameRate, rounding: Rounding): number {
  const step = ticksPerFrame(fps);
  const floor = Math.floor(integer(ticks, `${ticks} ticks`) / step);
  const remainder = ticks - floor * step;
  if (remainder === 0 || rounding === "floor") return floor;
  if (rounding === "ceil") return floor + 1;
  return remainder * 2 >= step ? floor + 1 : floor;
}

function integer(value: number, what: string): number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${what} is not a safe integer`);
  return value;
}
