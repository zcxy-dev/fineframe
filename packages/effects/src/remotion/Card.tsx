import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import type { ComponentType } from "react";
import { AbsoluteFill } from "remotion";
import type { CardId, CardParams } from "../cards.ts";
import { type CardLayout, COLORS, cardLayout } from "../layout.ts";
import { AppCard } from "./cards/app.tsx";
import { BarChart } from "./cards/bar-chart.tsx";
import { BeforeAfter } from "./cards/before-after.tsx";
import { Chat } from "./cards/chat.tsx";
import { Checklist } from "./cards/checklist.tsx";
import { Code } from "./cards/code.tsx";
import { Definition } from "./cards/definition.tsx";
import { Highlight } from "./cards/highlight.tsx";
import { IconGrid } from "./cards/icon-grid.tsx";
import { MONO } from "./cards/kit.tsx";
import { Kpis } from "./cards/kpis.tsx";
import { LineChart } from "./cards/line-chart.tsx";
import { List } from "./cards/list.tsx";
import { LogoReveal } from "./cards/logo.tsx";
import { Notifications } from "./cards/notifications.tsx";
import { Progress } from "./cards/progress.tsx";
import { ProsCons } from "./cards/pros-cons.tsx";
import { Quote } from "./cards/quote.tsx";
import { Ranking } from "./cards/ranking.tsx";
import { Ring } from "./cards/ring.tsx";
import { Search } from "./cards/search.tsx";
import { Section } from "./cards/section.tsx";
import { Stat } from "./cards/stat.tsx";
import { Steps } from "./cards/steps.tsx";
import { Table } from "./cards/table.tsx";
import { Terminal } from "./cards/terminal.tsx";
import { Timeline } from "./cards/timeline.tsx";
import { Versus } from "./cards/versus.tsx";
import { useFonts } from "./fonts.ts";
import { FACES, FAMILY } from "./Overlay.tsx";
import type { CardProps } from "./props.ts";

const CARDS: {
  [Id in CardId]: ComponentType<{ params: CardParams[Id]; layout: CardLayout }>;
} = {
  stat: Stat,
  kpis: Kpis,
  list: List,
  checklist: Checklist,
  versus: Versus,
  "before-after": BeforeAfter,
  quote: Quote,
  steps: Steps,
  timeline: Timeline,
  "bar-chart": BarChart,
  "line-chart": LineChart,
  ring: Ring,
  progress: Progress,
  chat: Chat,
  terminal: Terminal,
  code: Code,
  app: AppCard,
  logo: LogoReveal,
  "icon-grid": IconGrid,
  definition: Definition,
  highlight: Highlight,
  search: Search,
  notifications: Notifications,
  "pros-cons": ProsCons,
  ranking: Ranking,
  section: Section,
  table: Table,
};

// Text the cards draw that their params need not hold: default labels and fixed captions.
const FIXED_TEXT = "之前之後優點缺點 VS DEFINITION terminal $%#0123456789";
const CARD_FACES = [...FACES, ...[400, 700].map((weight) => `${weight} 16px "${MONO}"`)];

export function Card({ card, params, placement, aspect, width, height }: CardProps) {
  useFonts(CARD_FACES, FIXED_TEXT + JSON.stringify(params));
  const Body = CARDS[card] as ComponentType<{ params: CardParams[CardId]; layout: CardLayout }>;
  return (
    <AbsoluteFill
      style={{
        fontFamily: `"${FAMILY}", sans-serif`,
        color: COLORS.paper,
        lineBreak: "strict",
        overflowWrap: "anywhere",
      }}
    >
      <Body params={params} layout={cardLayout(aspect, placement, width, height)} />
    </AbsoluteFill>
  );
}
