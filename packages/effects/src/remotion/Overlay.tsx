import "@fontsource/noto-sans-tc/500.css";
import "@fontsource/noto-sans-tc/700.css";
import "@fontsource/noto-sans-tc/900.css";
import { type ComponentType, useEffect, useState } from "react";
import { AbsoluteFill, cancelRender, continueRender, delayRender } from "remotion";
import type { TemplateId, TemplateParams } from "../catalog.ts";
import { COLORS, type Layout, layoutFor } from "../layout.ts";
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

const FAMILY = "Noto Sans TC";
const WEIGHTS = [500, 700, 900];

export function Overlay({ template, params, aspect, width, height }: OverlayProps) {
  // Noto Sans TC comes in slices by Unicode range; the frame waits until every slice the text
  // needs has loaded, so no frame is captured in a fallback font.
  const [handle] = useState(() => delayRender(`Loading ${FAMILY}`));
  useEffect(() => {
    const text = JSON.stringify(params);
    Promise.all(WEIGHTS.map((weight) => document.fonts.load(`${weight} 16px "${FAMILY}"`, text)))
      .then(() => continueRender(handle))
      .catch(cancelRender);
  }, [handle, params]);

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
