// B-roll from free sources, for the planner to call: web captures, stock footage with the user's
// own keys, icons and logos from open sets, and a small CC0 set of sound effects.
export { type Capture, type CaptureOptions, capturePage, openCaptureBrowser } from "./capture.ts";
export { type Credit, creditText, writeCredits } from "./credits.ts";
export { findIcon, type Icon, type IconOptions, type IconSet } from "./icons.ts";
export { pickSfx, SFX_KINDS, SFX_LICENSE, type Sfx, type SfxKind, sfxOf } from "./sfx.ts";
export {
  findStock,
  type Provider,
  STOCK_KEYS,
  type StockClip,
  type StockOptions,
  stockProviders,
} from "./stock.ts";
