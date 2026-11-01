# Third-party notices

The site's own code and text are proprietary, all rights reserved. It uses the components and media below, each under its own licence.

## Fonts, served from the site

| Font | Package | Licence |
|---|---|---|
| [Geist](https://github.com/vercel/geist-font) | `@fontsource-variable/geist` 5.3.0, its Latin face cut by `scripts/fonts.ts` to the characters the site uses | [SIL Open Font License 1.1](https://openfontlicense.org) |
| [Noto Sans TC](https://github.com/notofonts/noto-cjk) | `@expo-google-fonts/noto-sans-tc` 0.4.4, its Regular, SemiBold and Black cut by `scripts/fonts.ts` to the characters the site uses | SIL Open Font License 1.1 |

## npm packages (direct dependencies)

| Package | Licence | Used for |
|---|---|---|
| [next](https://nextjs.org) | MIT | building the site |
| [react](https://react.dev), react-dom | MIT | building the site |
| [typescript](https://www.typescriptlang.org) | Apache-2.0 | development |
| [@biomejs/biome](https://biomejs.dev) | MIT OR Apache-2.0 | development |
| [tailwindcss](https://tailwindcss.com), @tailwindcss/postcss, [postcss](https://postcss.org) | MIT | building the styles |
| [budoux](https://github.com/google/budoux) | Apache-2.0 | finding the phrases Chinese lines break between |
| [class-variance-authority](https://cva.style) | Apache-2.0 | the button's variants |
| [cn](https://github.com/shadcn-ui/cn) | MIT | merging class names |
| [subset-font](https://github.com/papandreou/subset-font) | BSD-3-Clause | cutting Noto Sans TC to the site's characters |
| @types/node, @types/react, @types/react-dom | MIT | development |

## Components copied into the site

`components/ui/` holds the button, input and label, first added from [shadcn/ui](https://ui.shadcn.com) (MIT, Copyright (c) 2023 shadcn) and rewritten for the site. The icons in `components/Icon.tsx` are drawn after [Lucide](https://lucide.dev)'s ([ISC](https://github.com/lucide-icons/lucide/blob/main/LICENSE)).

## Example edits

The home page shows edits Fineframe 0.5.0 made, with no manual steps, from three videos. `public/media/` holds loops cut from them, re-encoded for the web, with a smaller copy for phones (`-sm`) where the page shows them large, each with its first frame (`.webp`): the hero's source footage (`hero-source`) and the opening of the 9:16 short made from it (`hero-edit`), both from Don Pettit's talk; the 9:16 edit of 极客湾Geekerwan's interview (`captions`); and the 16:9 edit of Christina Koch's interview (`wide`). None has sound. `app/[locale]/og.png/reel.jpg` is `hero-edit`'s first frame again, as a JPEG for the share cards a shared link shows (`/en/og.png`, `/zh-tw/og.png`), which credit it under it. `/credits/` lists the same sources on the site.

- **Footage**, all in the public domain as works of NASA, which does not endorse Fineframe; neither do the people in it:
  - "[Christina Koch Artemis II Crew Announcement Resource Reel](https://images.nasa.gov/details/jsc2023m000095_Christina_Koch_Artemis_II_Crew_Announcement_Resource_Reel-social)", NASA, 3 April 2023;
  - "[NASA Astronaut Don Pettit Talks with the Everyday Astronaut](https://images.nasa.gov/details/iss072m263521849_NASA_Astronaut_Don_Pettit_Talks_with_the_Everyday_Astronaut_241217)", NASA, 17 December 2024.
- **Mandarin footage:** "[采访vivo & MediaTek研发大佬：蓝厂与天玑合作背后的故事](https://www.youtube.com/watch?v=_G4e2p1p-is)" by 极客湾Geekerwan, 4 January 2025, licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) ([file on Wikimedia Commons](https://commons.wikimedia.org/wiki/File:%E9%87%87%E8%AE%BFvivo_%26_MediaTek%E7%A0%94%E5%8F%91%E5%A4%A7%E4%BD%AC%EF%BC%9A%E8%93%9D%E5%8E%82%E4%B8%8E%E5%A4%A9%E7%8E%91%E5%90%88%E4%BD%9C%E8%83%8C%E5%90%8E%E7%9A%84%E6%95%85%E4%BA%8B.webm)). Fineframe cut it to a 44 s 9:16 edit (`captions`), captioned it in Traditional characters, and added music and graphics. Geekerwan, vivo and MediaTek are not affiliated with Fineframe and do not endorse it.
- **In the edits' motion graphics**, icons from [Lucide](https://lucide.dev) ([ISC](https://github.com/lucide-icons/lucide/blob/main/LICENSE)).
