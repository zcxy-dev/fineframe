// Next's own types: CSS imports and the like. Next writes next-env.d.ts on every build with
// paths of that build, so it stays out of git and this file stands in for it.
/// <reference types="next" />

// `scripts/fonts.ts` uses subset-font, which ships no types.
declare module "subset-font" {
  export default function subsetFont(
    font: Buffer,
    text: string,
    options?: { targetFormat?: "sfnt" | "woff" | "woff2" },
  ): Promise<Buffer>;
}
