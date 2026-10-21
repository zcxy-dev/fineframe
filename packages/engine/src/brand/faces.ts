// The faces a brand kit can name by id: open-licence faces that cover Traditional Chinese and allow
// commercial use, each downloaded on first use from its publisher at a pinned commit and checked
// against its SHA-256, as the caption face is (./kit.ts). Noto Sans TC is the house face itself.
// No Node module, so the web page's pickers read it too.

import type { BrandFont } from "@video-editor/schema";

export type FaceId = Extract<BrandFont, { id: string }>["id"];

const GOOGLE =
  "https://raw.githubusercontent.com/google/fonts/47d54ca1ebb14fd864695f1d39dc734f39017c33/ofl";
const NOTO =
  "https://raw.githubusercontent.com/notofonts/noto-cjk/f8d157532fbfaeda587e826d4cd5b21a49186f7c";
const HUNINN =
  "https://raw.githubusercontent.com/justfont/open-huninn-font/f240f9071a78298f379bc087cae2010df11cf477";

/** Each face by its id: its name, and the file to download, or none for the house face. */
export const FACES: Record<FaceId, { name: string; file?: { url: string; sha256: string } }> = {
  "noto-sans-tc": { name: "Noto Sans TC" },
  "noto-serif-tc": { name: "Noto Serif TC", file: { url: `${NOTO}/Serif/OTF/TraditionalChinese/NotoSerifCJKtc-Bold.otf`, sha256: "a4441a76dbf56719600c5dcbd5b5e5a068a20944cc41c959487a657133576ee6" } },
  "lxgw-wenkai-tc": { name: "LXGW WenKai TC", file: { url: `${GOOGLE}/lxgwwenkaitc/LXGWWenKaiTC-Bold.ttf`, sha256: "5c9feadfd928f3ae3860e7d001ad3d0d0c55b0157fff08cd4d51b51aca677f23" } },
  "jf-openhuninn": { name: "jf open huninn", file: { url: `${HUNINN}/font/jf-openhuninn-2.1.ttf`, sha256: "9d5bf4932d31fe94c18cd8cfddc98bc1b14ce10f4e354c682179db290a99c825" } },
  iansui: { name: "Iansui", file: { url: `${GOOGLE}/iansui/Iansui-Regular.ttf`, sha256: "6e6340d80d618a42b48ade9370c34fa37a8210750c6fbc8efe65f23716538a2b" } },
  "chocolate-classical-sans": { name: "Chocolate Classical Sans", file: { url: `${GOOGLE}/chocolateclassicalsans/ChocolateClassicalSans-Regular.ttf`, sha256: "e6345f3d92c7a9b7044c31a87d9b61f50220b08c0f1dcc2736e94c2aa587ce03" } },
  "cactus-classical-serif": { name: "Cactus Classical Serif", file: { url: `${GOOGLE}/cactusclassicalserif/CactusClassicalSerif-Regular.ttf`, sha256: "ecbd58961db922392d7fecfafa3681fefaeec0c399b860ab6940ba700f7da055" } },
  "lxgw-marker-gothic": { name: "LXGW Marker Gothic", file: { url: `${GOOGLE}/lxgwmarkergothic/LXGWMarkerGothic-Regular.ttf`, sha256: "e6a55cfd5f18dc393f92670a164397a69242cb4eabe1d3feb5dc22fc4947a8ba" } },
}; // biome-ignore format: one face per line

export const faceIds = Object.keys(FACES) as FaceId[];

export function isFaceId(id: string): id is FaceId {
  return Object.hasOwn(FACES, id);
}
