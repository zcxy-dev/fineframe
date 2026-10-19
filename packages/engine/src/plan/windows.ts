// The windows of a video call's layout: each person's picture as a rectangle on a plain
// background, so that a portrait crop of the one who speaks fills the frame with their window
// instead of the background around it (packages/engine/README.md#framing).

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FramedShot, type MediaIndex, type Rect, ticksToSeconds } from "@video-editor/schema";
import { type Grey, grey } from "./locate.ts";

/** Grey levels a pixel's 3 × 3 neighbourhood spans at most for it to count as plain. */
const FLAT = 3;
/** The background is the commonest plain grey level, give or take SAME, over at least this share
 * of the frame. */
const BACKGROUND = 0.1;
const SAME = 6;
const REACH = 2;
/** A window's edges: at most INSIDE of the line just inside each is background, and at least
 * OUTSIDE of the line just outside each that lies in the frame. A person against a plain wall
 * has wall inside the top of their outline, so they are no window. */
const INSIDE = 0.5;
const OUTSIDE = 0.8;
/** A window covers less of the frame than this, and more than its face. */
const LARGEST = 0.8;

/** Windows already found, per shot: each review plans the same footage again. */
const found = new WeakMap<FramedShot, Map<number, Rect>>();

/**
 * The window each face is in, by face id, in the shots of the source a clip plays (in source
 * ticks) that have two or more faces and, halfway through, have them in windows on a plain
 * background, as video calls lay people out. Faces in other shots have none.
 */
export async function callWindows(
  path: string,
  index: MediaIndex,
  clip: { in: number; out: number },
): Promise<Map<number, Rect>> {
  const windows = new Map<number, Rect>();
  const from = ticksToSeconds(clip.in);
  const to = ticksToSeconds(clip.out);
  const shots = (index.framing?.shots ?? []).filter(
    (shot) =>
      shot.start < to &&
      shot.end > from &&
      shot.faces.length >= 2 &&
      shot.layout !== "screen" &&
      shot.layout !== "screen_cam",
  );
  const missing = shots.filter((shot) => !found.has(shot));
  if (missing.length > 0) {
    const dir = await mkdtemp(join(tmpdir(), "windows-"));
    try {
      for (const shot of missing) {
        const frame = await grey(path, (shot.start + shot.end) / 2, dir);
        const faces = shot.faces.map(
          (face) => face.boxes[Math.floor(face.boxes.length / 2)] ?? face.boxes[0],
        );
        const own = new Map<number, Rect>();
        for (const [k, window] of windowsIn(frame, faces).entries()) {
          const face = shot.faces[k];
          if (window && face) own.set(face.id, window);
        }
        found.set(shot, own);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  for (const shot of shots)
    for (const [id, window] of found.get(shot) ?? []) windows.set(id, window);
  return windows;
}

/**
 * The window around each face on a grey frame, as fractions of it, or undefined: the region of
 * pixels that are not plain background joined to the face's centre, when its bounding box has
 * straight edges against the background.
 */
export function windowsIn(frame: Grey, faces: readonly Rect[]): (Rect | undefined)[] {
  const { pixels, width, height } = frame;
  // Clamped at the frame's edges, so a background that runs to the edge is background there too.
  const at = (x: number, y: number) =>
    pixels[Math.min(Math.max(y, 0), height - 1) * width + Math.min(Math.max(x, 0), width - 1)] ?? 0;
  const flat = new Uint8Array(width * height);
  const counts = new Array<number>(256).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let low = 255;
      let high = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const v = at(x + dx, y + dy);
          low = Math.min(low, v);
          high = Math.max(high, v);
        }
      }
      if (high - low <= FLAT) {
        flat[y * width + x] = 1;
        counts[at(x, y)] = (counts[at(x, y)] ?? 0) + 1;
      }
    }
  }
  const near = (level: number) =>
    counts.slice(Math.max(0, level - SAME), level + SAME + 1).reduce((sum, n) => sum + n, 0);
  let level = 0;
  for (let v = 1; v < 256; v++) if (near(v) > near(level)) level = v;
  if (near(level) < BACKGROUND * width * height) return faces.map(() => undefined);
  // Background is the background's level within REACH pixels of plain background: next to a
  // window a pixel's neighbourhood takes in the window's edge, while dark parts of a picture,
  // never plain, stay picture.
  const plain = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!flat[y * width + x] || Math.abs(at(x, y) - level) > SAME) continue;
      for (let dy = -REACH; dy <= REACH; dy++) {
        for (let dx = -REACH; dx <= REACH; dx++) {
          const [nx, ny] = [x + dx, y + dy];
          if (nx >= 0 && ny >= 0 && nx < width && ny < height) plain[ny * width + nx] = 1;
        }
      }
    }
  }
  const background = (x: number, y: number) =>
    plain[y * width + x] === 1 && Math.abs(at(x, y) - level) <= SAME;

  return faces.map((face) => {
    const sx = Math.min(width - 1, Math.floor((face.x + face.w / 2) * width));
    const sy = Math.min(height - 1, Math.floor((face.y + face.h / 2) * height));
    if (background(sx, sy)) return undefined;
    // The region joined to the face's centre, by flood fill.
    const region = new Uint8Array(width * height);
    const stack = [sy * width + sx];
    region[sy * width + sx] = 1;
    let [x0, y0, x1, y1] = [sx, sy, sx, sy];
    while (stack.length > 0) {
      const i = stack.pop() as number;
      const x = i % width;
      const y = (i - x) / width;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ] as const) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (region[j] || background(nx, ny)) continue;
        region[j] = 1;
        stack.push(j);
      }
    }
    // The window is the run of columns, and of rows, around the face that the region mostly
    // fills: a caption box or a logo joined to it runs past only a few rows or columns.
    const covered = (xs: [number, number], ys: [number, number]) => {
      let n = 0;
      for (let y = ys[0]; y <= ys[1]; y++) {
        for (let x = xs[0]; x <= xs[1]; x++) n += region[y * width + x] ?? 0;
      }
      return n / ((xs[1] - xs[0] + 1) * (ys[1] - ys[0] + 1));
    };
    for (let pass = 0; pass < 3; pass++) {
      let [a, b] = [sx, sx];
      while (a > x0 && covered([a - 1, a - 1], [y0, y1]) >= 0.5) a--;
      while (b < x1 && covered([b + 1, b + 1], [y0, y1]) >= 0.5) b++;
      [x0, x1] = [a, b];
      [a, b] = [sy, sy];
      while (a > y0 && covered([x0, x1], [a - 1, a - 1]) >= 0.5) a--;
      while (b < y1 && covered([x0, x1], [b + 1, b + 1]) >= 0.5) b++;
      [y0, y1] = [a, b];
    }
    const share = (xs: [number, number], ys: [number, number]) => {
      let plain = 0;
      let all = 0;
      for (let y = ys[0]; y <= ys[1]; y++) {
        for (let x = xs[0]; x <= xs[1]; x++) {
          all++;
          if (background(x, y)) plain++;
        }
      }
      return plain / all;
    };
    // The line just outside skips one pixel, which scaling blends into the window's edge.
    const sides = [
      {
        inside: share([x0, x0], [y0, y1]),
        outside: x0 > 1 ? share([x0 - 2, x0 - 2], [y0, y1]) : 1,
      },
      {
        inside: share([x1, x1], [y0, y1]),
        outside: x1 < width - 2 ? share([x1 + 2, x1 + 2], [y0, y1]) : 1,
      },
      {
        inside: share([x0, x1], [y0, y0]),
        outside: y0 > 1 ? share([x0, x1], [y0 - 2, y0 - 2]) : 1,
      },
      {
        inside: share([x0, x1], [y1, y1]),
        outside: y1 < height - 2 ? share([x0, x1], [y1 + 2, y1 + 2]) : 1,
      },
    ];
    if (sides.some((side) => side.inside > INSIDE || side.outside < OUTSIDE)) return undefined;
    const window = {
      x: x0 / width,
      y: y0 / height,
      w: (x1 + 1 - x0) / width,
      h: (y1 + 1 - y0) / height,
    };
    if (window.w * window.h >= LARGEST || window.w * window.h <= face.w * face.h) return undefined;
    return window;
  });
}
