// Renders each card's example, for reviewing the cards' design: a still per card at every aspect
// and placement asked for, and an MP4 of each card named with --mp4.
//
//   node scripts/cards-preview.ts <folder> [--frame <seconds>] [--only <card,...>]
//     [--at <aspect>/<placement>,...] [--mp4 <card,...>]
//
// Stills are <folder>/<aspect>-<placement>/<card>.png; the default is 9:16/full at 3 s.

import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { bundle } from "@remotion/bundler";
import { openBrowser, renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { type CardId, cardIds, cards } from "../src/cards.ts";
import { type Aspect, cardSize, type Placement } from "../src/layout.ts";
import { CARD_COMPOSITION, type CardProps } from "../src/remotion/props.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    frame: { type: "string", default: "3" },
    only: { type: "string" },
    at: { type: "string", default: "9:16/full" },
    mp4: { type: "string", default: "" },
  },
});
const [folderArg] = positionals;
if (!folderArg) {
  console.error(
    "Usage: node scripts/cards-preview.ts <folder> [--frame s] [--only ids] [--at 9:16/full,16:9/panel] [--mp4 ids]",
  );
  process.exit(2);
}
const folder = resolve(process.env.INIT_CWD ?? process.cwd(), folderArg);

/** The card's size in a 1080p output: the frame, or the upper panel of a split screen. */
function size(aspect: Aspect, placement: Placement): [number, number] {
  const sizes: Record<Aspect, [number, number]> = {
    "16:9": [1920, 1080],
    "1:1": [1080, 1080],
    "9:16": [1080, 1920],
  };
  return cardSize(aspect, placement, ...sizes[aspect]);
}

const ids = (values.only?.split(",") ?? cardIds) as CardId[];
const fps = 30;
const serveUrl = await bundle({
  entryPoint: new URL("../src/remotion/root.tsx", import.meta.url).pathname,
  enableCaching: false,
});
const browser = await openBrowser("chrome", { logLevel: "error" });
const props = (card: CardId, at: string, seconds: number): CardProps => {
  const [aspect, placement] = at.split("/") as [Aspect, Placement];
  const [width, height] = size(aspect, placement);
  const frames = Math.round(seconds * fps);
  return { card, params: cards[card].example, placement, aspect, width, height, fps, frames };
};
try {
  for (const at of values.at.split(",")) {
    const dir = join(folder, at.replace(/[:/]/g, "-"));
    await mkdir(dir, { recursive: true });
    for (const card of ids) {
      const inputProps = props(
        card,
        at,
        Math.max(cards[card].seconds.typical, Number(values.frame) + 0.1),
      );
      const composition = await selectComposition({
        serveUrl,
        id: CARD_COMPOSITION,
        inputProps,
        puppeteerInstance: browser,
      });
      await renderStill({
        serveUrl,
        composition,
        inputProps,
        puppeteerInstance: browser,
        frame: Math.round(Number(values.frame) * fps),
        output: join(dir, `${card}.png`),
      });
      console.log(join(dir, `${card}.png`));
    }
  }
  for (const card of values.mp4.split(",").filter(Boolean) as CardId[]) {
    const inputProps = props(
      card,
      values.at.split(",")[0] as string,
      cards[card].seconds.typical + 1,
    );
    const composition = await selectComposition({
      serveUrl,
      id: CARD_COMPOSITION,
      inputProps,
      puppeteerInstance: browser,
    });
    const output = join(folder, `${card}.mp4`);
    await renderMedia({
      serveUrl,
      composition,
      inputProps,
      puppeteerInstance: browser,
      codec: "h264",
      outputLocation: output,
    });
    console.log(output);
  }
} finally {
  await browser.close({ silent: true });
}
