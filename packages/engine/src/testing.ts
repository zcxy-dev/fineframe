// Builders for tests: projects and source facts without files, and folders that clean up.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import type { Project } from "@video-editor/schema";
import type { SourceFacts } from "./sources.ts";

export const SECOND = 120_000;

export function facts(id: string, overrides: Partial<SourceFacts> = {}): SourceFacts {
  return {
    id,
    kind: "video",
    path: `/footage/${id}.mp4`,
    audio: true,
    hdr: null,
    matrix: null,
    frameTicks: 4000,
    duration: 60,
    zero: 0,
    faces: null,
    speech: [],
    voice: null,
    ...overrides,
  };
}

const fingerprint = { bytes: 1, sha256: "0".repeat(64) };

/** A 16:9 30 fps project over sources `a` and `b` whose target is the edit's own length. */
export function project(main: Project["main"], extra: Partial<Project> = {}): Project {
  let length = 0;
  for (const clip of main) {
    length += clip.out - clip.in;
    if (clip.transition?.type === "dissolve") length -= clip.transition.duration;
  }
  return {
    version: 1,
    output: {
      aspect: "16:9",
      width: 1280,
      height: 720,
      fps: { num: 30, den: 1 },
      target: { duration: Math.max(length, 1), tolerance: 0.05 },
    },
    sources: [
      { id: "a", kind: "video", path: "a.mp4", index: "a.json", fingerprint },
      { id: "b", kind: "video", path: "b.mp4", index: "b.json", fingerprint },
    ],
    main,
    audio: { loudness: { integratedLufs: -14, truePeakDbtp: -1 } },
    ...extra,
  };
}

export const sources = (...list: SourceFacts[]) => new Map(list.map((fact) => [fact.id, fact]));

/** A temporary folder for one test, removed with everything in it when the test ends. */
export async function scratch(t: TestContext, prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
