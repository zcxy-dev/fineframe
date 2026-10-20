import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { scratch } from "../testing.ts";
import { findIcon, ICON_SETS } from "./icons.ts";

/** Made-up sets laid out as the pinned tarballs unpack, so no lookup downloads. */
async function sets(dir: string): Promise<void> {
  const files: Record<string, string> = {
    "lucide/icons/rocket.svg":
      '<!-- @license lucide-static -->\n<svg class="lucide"><path d="M1"/></svg>',
    "lucide/icons/x.svg": '<svg class="lucide"><path d="M2"/></svg>',
    "lucide/icons/alert-circle.svg": '<svg class="lucide lucide-alert-circle"><path d="M8"/></svg>',
    "lucide/icons/circle-alert.svg": '<svg class="lucide lucide-circle-alert"><path d="M8"/></svg>',
    "lucide/tags.json": JSON.stringify({
      rocket: ["launch", "startup"],
      x: ["close"],
      "circle-alert": ["warning"],
    }),
    "lucide/LICENSE":
      "ISC License\n\nThe following Lucide icons are derived from the Feather project:\n\nx, check, alert-circle\n",
    "tabler/icons/outline/shopping-cart.svg": '<svg class="tabler"><path d="M3"/></svg>',
    "tabler/icons/outline/rocket.svg": '<svg class="tabler"><path d="M4"/></svg>',
    "tabler/icons.json": JSON.stringify({
      "shopping-cart": { tags: ["buy", "store"], styles: { outline: {} } },
      rocket: { tags: [], styles: { outline: {} } },
    }),
    "tabler/LICENSE": "MIT",
    "simple-icons/icons/github.svg": '<svg role="img" viewBox="0 0 24 24"><path d="M5"/></svg>',
    "simple-icons/icons/rocket.svg": '<svg role="img" viewBox="0 0 24 24"><path d="M7"/></svg>',
    "simple-icons/icons/dotnet.svg": '<svg role="img" viewBox="0 0 24 24"><path d="M6"/></svg>',
    "simple-icons/data/simple-icons.json": JSON.stringify([
      {
        title: "GitHub",
        slug: "github",
        hex: "181717",
        source: "https://github.com/logos",
        guidelines: "https://github.com/logos",
      },
      {
        title: ".NET",
        slug: "dotnet",
        hex: "512BD4",
        source: "https://example.com/dotnet",
        license: { type: "MIT" },
        aliases: { aka: ["Dot Net"] },
      },
      { title: "Rocket", slug: "rocket", hex: "D33847", source: "https://example.com/rocket" },
    ]),
  };
  for (const [path, text] of Object.entries(files)) {
    const [set = "", ...rest] = path.split("/");
    const version = ICON_SETS[set as keyof typeof ICON_SETS].version;
    const out = join(dir, `${set}-${version}`, ...rest);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, text);
  }
}

test("a brand's name finds its logo in the brand's colour, with its trademark noted", async (t) => {
  const dir = await scratch(t, "icons-");
  await sets(dir);
  const logo = await findIcon("GitHub", { dir });
  assert.equal(logo?.set, "simple-icons");
  assert.equal(logo?.hex, "#181717");
  assert.match(logo?.svg ?? "", /^<svg fill="#181717" role="img"/);
  assert.equal(logo?.credit.license?.name, "CC0-1.0");
  assert.match(logo?.credit.note ?? "", /GitHub is a trademark of its owner.*github\.com\/logos/);
  // Spelled as Simple Icons spells slugs, or by another name, with the logo's own licence.
  const dotnet = await findIcon("dot net", { dir, kind: "logo" });
  assert.equal(dotnet?.name, "dotnet");
  assert.equal(dotnet?.credit.license?.name, "MIT");
  assert.equal((await findIcon(".NET", { dir }))?.name, "dotnet");
  assert.equal(await findIcon("nothing like it", { dir, kind: "logo" }), null);
});

test("a symbol is found by name, then by tag, Lucide before Tabler", async (t) => {
  const dir = await scratch(t, "icons-");
  await sets(dir);
  // A symbol's exact name wins over a brand of that name, unless a logo is asked for.
  const rocket = await findIcon("Rocket", { dir });
  assert.equal(rocket?.set, "lucide");
  assert.equal((await findIcon("Rocket", { dir, kind: "logo" }))?.set, "simple-icons");
  assert.equal(rocket?.svg, '<svg class="lucide"><path d="M1"/></svg>');
  assert.equal(rocket?.credit.license?.name, "ISC");
  // Icons drawn from Feather stay MIT.
  assert.equal((await findIcon("x", { dir }))?.credit.license?.name, "MIT");
  // Under a name it took after the licence listed it too.
  assert.equal((await findIcon("warning", { dir }))?.name, "circle-alert");
  assert.equal((await findIcon("warning", { dir }))?.credit.license?.name, "MIT");
  const cart = await findIcon("shopping cart", { dir, kind: "symbol" });
  assert.equal(cart?.set, "tabler");
  assert.equal(cart?.credit.source, "https://tabler.io/icons/icon/shopping-cart");
  assert.equal((await findIcon("startup", { dir }))?.name, "rocket");
  assert.equal((await findIcon("github", { dir, kind: "symbol" })) ?? null, null);
  assert.equal(await findIcon("nothing like it", { dir }), null);
});
