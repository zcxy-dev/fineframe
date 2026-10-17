import "@fontsource/noto-sans-tc/500.css";
import "@fontsource/noto-sans-tc/700.css";
import "@fontsource/noto-sans-tc/900.css";
import type { ComponentType } from "react";
import { AbsoluteFill } from "remotion";
import type { TemplateId, TemplateParams } from "../catalog.ts";
import { COLORS, type Layout, layoutFor } from "../layout.ts";
import { useFonts } from "./fonts.ts";
import type { OverlayProps } from "./props.ts";
import { Callout } from "./templates/callout.tsx";
import { Chapter } from "./templates/chapter.tsx";
import { Keyword } from "./templates/keyword.tsx";
import { LowerThird } from "./templates/lower-third.tsx";
import { Title } from "./templates/title.tsx";
import { Wipe } from "./templates/wipe.tsx";

const TEMPLATES: {
  [Id in TemplateId]: ComponentType<{ params: TemplateParams[Id]; layout: Layout }>;
} = {
  title: Title,
  "lower-third": LowerThird,
  keyword: Keyword,
  chapter: Chapter,
  callout: Callout,
  wipe: Wipe,
};

export const FAMILY = "Noto Sans TC";
export const FACES = [500, 700, 900].map((weight) => `${weight} 16px "${FAMILY}"`);

export function Overlay({ template, params, aspect, width, height }: OverlayProps) {
  useFonts(FACES, JSON.stringify(params));

  const Template = TEMPLATES[template] as ComponentType<{
    params: TemplateParams[TemplateId];
    layout: Layout;
  }>;
  return (
    <AbsoluteFill
      style={{
        fontFamily: `"${FAMILY}", sans-serif`,
        color: COLORS.paper,
        // Taiwanese line-breaking rules: no closing punctuation at the start of a line.
        lineBreak: "strict",
        overflowWrap: "anywhere",
      }}
    >
      <Template params={params} layout={layoutFor(aspect, width, height)} />
    </AbsoluteFill>
  );
}
