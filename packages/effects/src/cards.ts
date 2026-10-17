// The motion-graphics cards as the planner reads them: opaque B-roll that fills the frame or the
// upper panel of a split screen, each with what it is for, how long it runs and its params as a
// JSON Schema.

import { accent, object, text } from "./catalog.ts";
import { type IconName, iconNames, type LogoName, logoNames } from "./icons.ts";

type Color = string;
type Marked = { icon?: IconName; logo?: LogoName };
type Counted = { value: number; prefix?: string; suffix?: string; decimals?: number };

// Types, not interfaces, so params pass as an open record.
export type StatParams = Counted & {
  label: string;
  context?: string;
  trend?: "up" | "down";
  accent?: Color;
};
export type KpisParams = {
  title?: string;
  items: (Counted & { label: string })[];
  accent?: Color;
};
export type ListParams = {
  title?: string;
  items: { text: string; detail?: string }[];
  active?: number;
  accent?: Color;
};
export type ChecklistParams = { title?: string; items: string[]; checked?: number; accent?: Color };
type Side = Marked & { name: string; points?: string[] };
export type VersusParams = { left: Side; right: Side; winner?: "left" | "right"; accent?: Color };
type State = Marked & { label?: string; text: string };
export type BeforeAfterParams = { title?: string; before: State; after: State; accent?: Color };
export type QuoteParams = Marked & { text: string; author: string; role?: string; accent?: Color };
export type StepsParams = {
  title?: string;
  steps: (Marked & { label: string })[];
  accent?: Color;
};
export type TimelineParams = {
  title?: string;
  events: { date: string; label: string }[];
  active?: number;
  accent?: Color;
};
export type BarChartParams = {
  title?: string;
  unit?: string;
  bars: { label: string; value: number }[];
  highlight?: number;
  accent?: Color;
};
export type LineChartParams = {
  title?: string;
  unit?: string;
  points: { label: string; value: number }[];
  accent?: Color;
};
export type RingParams = { value: number; label: string; context?: string; accent?: Color };
export type ProgressParams = {
  title?: string;
  items: { label: string; value: number }[];
  accent?: Color;
};
export type ChatParams = Marked & {
  app?: string;
  messages: { from: "user" | "ai"; text: string }[];
  accent?: Color;
};
export type TerminalParams = {
  title?: string;
  lines: { kind: "command" | "output" | "success" | "error"; text: string }[];
  accent?: Color;
};
export type CodeParams = {
  filename?: string;
  lines: string[];
  highlight?: number[];
  accent?: Color;
};
export type AppParams = Marked & {
  name: string;
  tagline: string;
  tags?: string[];
  url?: string;
  accent?: Color;
};
export type LogoParams = Marked & { name: string; tagline?: string; accent?: Color };
export type IconGridParams = {
  title?: string;
  items: (Marked & { label: string })[];
  accent?: Color;
};
export type DefinitionParams = {
  term: string;
  kind?: string;
  text: string;
  accent?: Color;
};
export type HighlightParams = {
  text: string;
  highlights: string[];
  source?: string;
  accent?: Color;
};
export type SearchParams = {
  query: string;
  results?: { title: string; url: string }[];
  accent?: Color;
};
export type NotificationsParams = {
  items: (Marked & { app: string; title: string; text: string; time?: string })[];
  accent?: Color;
};
export type ProsConsParams = {
  title?: string;
  pros: string[];
  cons: string[];
  prosLabel?: string;
  consLabel?: string;
  accent?: Color;
};
export type RankingParams = {
  title?: string;
  unit?: string;
  items: (Marked & { label: string; value: number })[];
  accent?: Color;
};
export type SectionParams = {
  title: string;
  index?: number;
  kicker?: string;
  accent?: Color;
};
export type TableParams = {
  columns: (Marked & { name: string })[];
  rows: { label: string; values: (boolean | string)[] }[];
  highlight?: number;
  accent?: Color;
};

export interface CardParams {
  stat: StatParams;
  kpis: KpisParams;
  list: ListParams;
  checklist: ChecklistParams;
  versus: VersusParams;
  "before-after": BeforeAfterParams;
  quote: QuoteParams;
  steps: StepsParams;
  timeline: TimelineParams;
  "bar-chart": BarChartParams;
  "line-chart": LineChartParams;
  ring: RingParams;
  progress: ProgressParams;
  chat: ChatParams;
  terminal: TerminalParams;
  code: CodeParams;
  app: AppParams;
  logo: LogoParams;
  "icon-grid": IconGridParams;
  definition: DefinitionParams;
  highlight: HighlightParams;
  search: SearchParams;
  notifications: NotificationsParams;
  "pros-cons": ProsConsParams;
  ranking: RankingParams;
  section: SectionParams;
  table: TableParams;
}
export type CardId = keyof CardParams;

export interface Card<P> {
  /** What the card shows the viewer. */
  purpose: string;
  /** The moments in an edit it serves. */
  whenToUse: string;
  /** How long it runs: the shortest its build allows, a typical length and the longest. */
  seconds: { min: number; typical: number; max: number };
  /** A JSON Schema (draft 2020-12) for its `params`. */
  params: object;
  example: P;
}

const icon = {
  description: "A Lucide icon's name.",
  type: "string",
  enum: iconNames,
} as const;
const logo = {
  description:
    "A brand's logo, from Simple Icons; drawn instead of `icon`. Only for the brand named.",
  type: "string",
  enum: logoNames,
} as const;
const list = (items: object, minItems: number, maxItems: number, description: string) => ({
  description,
  type: "array",
  minItems,
  maxItems,
  items,
});
const title = text("A heading over the card, in the speaker's language.", 24);
const number = (description: string, extra: object = {}) => ({
  description,
  type: "number",
  ...extra,
});
const index = (description: string) => ({ description, type: "integer", minimum: 1 });
const counted = {
  value: number(
    "The number the counter climbs to. Never invented: only a figure the speaker says.",
  ),
  prefix: text("Before the number, like `$` or `NT$`.", 4),
  suffix: text("After the number, like `%`, `倍`, `x` or `M`.", 6),
  decimals: { description: "Decimal places shown.", type: "integer", minimum: 0, maximum: 2 },
};

export const cards: { [Id in CardId]: Card<CardParams[Id]> } = {
  stat: {
    purpose: "One big number that counts up, with what it measures.",
    whenToUse: "The speaker states a striking figure: a result, a price, a growth rate.",
    seconds: { min: 1.8, typical: 3, max: 6 },
    params: object(
      {
        ...counted,
        label: text("What the number measures.", 28),
        context: text("A second line: the source, or the period.", 40),
        trend: { description: "An arrow beside the number.", type: "string", enum: ["up", "down"] },
        accent,
      },
      ["value", "label"],
    ),
    example: {
      value: 73,
      suffix: "%",
      label: "的工程師每天使用 AI",
      context: "範例數據",
      trend: "up",
    },
  },
  kpis: {
    purpose: "Two to four numbers side by side, each counting up with its label.",
    whenToUse: "A set of results the speaker lists together: before a deep dive, or as a recap.",
    seconds: { min: 2, typical: 3.5, max: 6 },
    params: object(
      {
        title,
        items: list(
          object({ ...counted, label: text("What it measures.", 14) }, ["value", "label"]),
          2,
          4,
          "The numbers, in the order spoken.",
        ),
        accent,
      },
      ["items"],
    ),
    example: {
      title: "上線第一個月",
      items: [
        { value: 12, suffix: "K", label: "使用者" },
        { value: 4.8, decimals: 1, label: "App Store 評分" },
        { value: 38, suffix: "%", label: "回訪率" },
      ],
    },
  },
  list: {
    purpose:
      "A numbered list that builds item by item; `active` lights one item and dims the rest.",
    whenToUse:
      "The speaker announces a list. Show every item early as an open loop, then give each item " +
      "its own shot with `active` set to it.",
    seconds: { min: 1.8, typical: 3, max: 6 },
    params: object(
      {
        title,
        items: list(
          object({ text: text("The item.", 22), detail: text("One line under it.", 36) }, ["text"]),
          2,
          5,
          "The items, in order.",
        ),
        active: index("The item to light, from 1; leave it out to light them all."),
        accent,
      },
      ["items"],
    ),
    example: {
      title: "三個必學的 AI 工具",
      items: [
        { text: "Claude Code", detail: "在終端機裡寫程式" },
        { text: "n8n", detail: "把流程自動化" },
        { text: "Notion AI", detail: "整理筆記與文件" },
      ],
    },
  },
  checklist: {
    purpose: "A checklist whose boxes tick one after another.",
    whenToUse: "Requirements, a setup the viewer can follow, or what a tool does for you.",
    seconds: { min: 2, typical: 3.5, max: 6 },
    params: object(
      {
        title,
        items: list(text("An item.", 26), 2, 6, "The items, in order."),
        checked: {
          description: "How many items from the top get ticked; leave it out to tick them all.",
          type: "integer",
          minimum: 0,
        },
        accent,
      },
      ["items"],
    ),
    example: {
      title: "開始之前",
      items: ["安裝 Node.js 22", "申請 API key", "建立專案資料夾", "設定環境變數"],
    },
  },
  versus: {
    purpose: "Two things face off across a VS badge, each with up to three points.",
    whenToUse: "The speaker compares two tools, models or approaches.",
    seconds: { min: 2, typical: 3.5, max: 6 },
    params: object(
      {
        left: object(
          {
            name: text("Its name.", 14),
            icon,
            logo,
            points: list(text("A point.", 16), 1, 3, "Short points under the name."),
          },
          ["name"],
        ),
        right: object(
          {
            name: text("Its name.", 14),
            icon,
            logo,
            points: list(text("A point.", 16), 1, 3, "Short points under the name."),
          },
          ["name"],
        ),
        winner: {
          description: "The side the speaker favours, lit in the accent.",
          type: "string",
          enum: ["left", "right"],
        },
        accent,
      },
      ["left", "right"],
    ),
    example: {
      left: { name: "手動剪輯", icon: "clock", points: ["一支影片 4 小時", "容易漏剪"] },
      right: { name: "AI 剪輯", icon: "sparkles", points: ["10 分鐘完成", "每次都一致"] },
      winner: "right",
    },
  },
  "before-after": {
    purpose: "A before state that turns into an after state across an arrow.",
    whenToUse: "A change the speaker describes: a workflow improved, a result fixed.",
    seconds: { min: 2, typical: 3.5, max: 6 },
    params: object(
      {
        title,
        before: object(
          {
            label: text("The before label; 之前 / Before without it.", 10),
            text: text("The before state.", 36),
            icon,
            logo,
          },
          ["text"],
        ),
        after: object(
          {
            label: text("The after label; 之後 / After without it.", 10),
            text: text("The after state.", 36),
            icon,
            logo,
          },
          ["text"],
        ),
        accent,
      },
      ["before", "after"],
    ),
    example: {
      before: { text: "每週花 6 小時回信", icon: "mail" },
      after: { text: "AI 草擬，只花 30 分鐘", icon: "bot" },
    },
  },
  quote: {
    purpose: "A quotation that reveals word by word, with who said it.",
    whenToUse: "The speaker quotes a person, a paper or a company.",
    seconds: { min: 2.5, typical: 4, max: 8 },
    params: object(
      {
        text: text("The words quoted, exactly; never paraphrased into quotation marks.", 80),
        author: text("Who said it.", 20),
        role: text("Their role or where it was said.", 28),
        icon,
        logo,
        accent,
      },
      ["text", "author"],
    ),
    example: { text: "最好的程式碼，是你不用寫的那一行。", author: "林語安", role: "前端工程師" },
  },
  steps: {
    purpose: "A process as icons joined by a line that draws from step to step.",
    whenToUse: "How something works, a pipeline, or the stages of a workflow.",
    seconds: { min: 2, typical: 3.5, max: 6 },
    params: object(
      {
        title,
        steps: list(
          object({ label: text("The step.", 10), icon, logo }, ["label"]),
          2,
          5,
          "The steps, in order.",
        ),
        accent,
      },
      ["steps"],
    ),
    example: {
      title: "自動化流程",
      steps: [
        { label: "收到信件", icon: "mail" },
        { label: "AI 分類", icon: "bot" },
        { label: "建立任務", icon: "list-checks" },
        { label: "通知團隊", icon: "send" },
      ],
    },
  },
  timeline: {
    purpose: "Dated events along a line that draws through them.",
    whenToUse: "A history, a release sequence or a plan the speaker walks through.",
    seconds: { min: 2, typical: 3.5, max: 6 },
    params: object(
      {
        title,
        events: list(
          object(
            {
              date: text("When: a year, a month or a day.", 10),
              label: text("What happened.", 18),
            },
            ["date", "label"],
          ),
          2,
          5,
          "The events, oldest first.",
        ),
        active: index("The event to light, from 1; leave it out for the last."),
        accent,
      },
      ["events"],
    ),
    example: {
      title: "AI 程式助手的演進",
      events: [
        { date: "2021", label: "自動補全" },
        { date: "2023", label: "聊天助手" },
        { date: "2025", label: "終端機代理" },
        { date: "2026", label: "多代理協作" },
      ],
    },
  },
  "bar-chart": {
    purpose: "Columns that grow to their values, one of them lit.",
    whenToUse: "The speaker compares a few amounts: prices, speeds, scores.",
    seconds: { min: 2, typical: 3.5, max: 6 },
    params: object(
      {
        title,
        unit: text("The values' unit, shown after each.", 6),
        bars: list(
          object(
            { label: text("The bar's label.", 10), value: number("Its value.", { minimum: 0 }) },
            ["label", "value"],
          ),
          2,
          6,
          "The bars, left to right.",
        ),
        highlight: index("The bar to light, from 1; leave it out for the largest."),
        accent,
      },
      ["bars"],
    ),
    example: {
      title: "每百萬 token 價格",
      unit: "美元",
      bars: [
        { label: "模型 A", value: 15 },
        { label: "模型 B", value: 3 },
        { label: "模型 C", value: 0.8 },
      ],
      highlight: 3,
    },
  },
  "line-chart": {
    purpose: "A line that draws through a series, ending on its last value.",
    whenToUse: "A trend over time: growth, a fall, a turning point.",
    seconds: { min: 2, typical: 3.5, max: 6 },
    params: object(
      {
        title,
        unit: text("The values' unit.", 6),
        points: list(
          object(
            { label: text("The point's label, like a month.", 8), value: number("Its value.") },
            ["label", "value"],
          ),
          3,
          12,
          "The series, in time order.",
        ),
        accent,
      },
      ["points"],
    ),
    example: {
      title: "每月訂閱人數",
      unit: "人",
      points: [
        { label: "1月", value: 1200 },
        { label: "2月", value: 1900 },
        { label: "3月", value: 2600 },
        { label: "4月", value: 4100 },
        { label: "5月", value: 6800 },
      ],
    },
  },
  ring: {
    purpose: "A ring that fills to a percentage as the number counts up.",
    whenToUse: "One share or completion rate the speaker states.",
    seconds: { min: 1.8, typical: 3, max: 6 },
    params: object(
      {
        value: number("The percentage, 0 to 100.", { minimum: 0, maximum: 100 }),
        label: text("What it is a share of.", 24),
        context: text("A second line: the source, or the period.", 36),
        accent,
      },
      ["value", "label"],
    ),
    example: { value: 82, label: "的任務由 AI 完成", context: "範例數據" },
  },
  progress: {
    purpose: "Up to four labelled bars that fill to their percentages.",
    whenToUse: "Progress toward goals, or a few shares compared.",
    seconds: { min: 2, typical: 3.5, max: 6 },
    params: object(
      {
        title,
        items: list(
          object(
            {
              label: text("What the bar measures.", 16),
              value: number("The percentage, 0 to 100.", { minimum: 0, maximum: 100 }),
            },
            ["label", "value"],
          ),
          1,
          4,
          "The bars, top to bottom.",
        ),
        accent,
      },
      ["items"],
    ),
    example: {
      title: "專案進度",
      items: [
        { label: "設計", value: 100 },
        { label: "開發", value: 72 },
        { label: "測試", value: 35 },
      ],
    },
  },
  chat: {
    purpose: "A chat window where the user's messages appear and the assistant's reply streams in.",
    whenToUse: "The speaker describes asking an AI something, or shows a prompt and its answer.",
    seconds: { min: 2.5, typical: 4.5, max: 8 },
    params: object(
      {
        app: text("The window's title, like the assistant's name.", 16),
        icon,
        logo,
        messages: list(
          object(
            { from: { type: "string", enum: ["user", "ai"] }, text: text("The message.", 90) },
            ["from", "text"],
          ),
          1,
          4,
          "The messages, in order. Label made-up exchanges as examples.",
        ),
        accent,
      },
      ["messages"],
    ),
    example: {
      app: "Claude",
      logo: "claude",
      messages: [
        { from: "user", text: "幫我把這段影片剪成 60 秒的短影音" },
        { from: "ai", text: "好的！我找到 3 個重點段落，已經去掉停頓並加上字幕。" },
      ],
    },
  },
  terminal: {
    purpose: "A terminal where commands type out and their output prints.",
    whenToUse: "The speaker runs a command, installs a tool or shows an agent working in a shell.",
    seconds: { min: 2.5, typical: 4, max: 8 },
    params: object(
      {
        title: text("The window's title.", 24),
        lines: list(
          object(
            {
              kind: {
                type: "string",
                enum: ["command", "output", "success", "error"],
                description: "A command types out after a prompt; the others print at once.",
              },
              text: text("The line.", 56),
            },
            ["kind", "text"],
          ),
          1,
          8,
          "The lines, top to bottom.",
        ),
        accent,
      },
      ["lines"],
    ),
    example: {
      title: "~/projects/demo",
      lines: [
        { kind: "command", text: "npm install -g @anthropic-ai/claude-code" },
        { kind: "output", text: "added 1 package in 3s" },
        { kind: "command", text: 'claude "fix the failing test"' },
        { kind: "success", text: "✓ 1 test fixed, all 42 passing" },
      ],
    },
  },
  code: {
    purpose: "An editor window with code that writes in line by line, some lines lit.",
    whenToUse: "The speaker shows or explains a few lines of code.",
    seconds: { min: 2.5, typical: 4, max: 8 },
    params: object(
      {
        filename: text("The file's name in the tab.", 24),
        lines: list(
          { type: "string", maxLength: 48 },
          1,
          10,
          "The code, one line per entry, indented with spaces.",
        ),
        highlight: list({ type: "integer", minimum: 1 }, 1, 4, "Lines to light, from 1."),
        accent,
      },
      ["lines"],
    ),
    example: {
      filename: "agent.ts",
      lines: [
        "const reply = await client.messages.create({",
        '  model: "claude-opus-5-5",',
        "  max_tokens: 1024,",
        '  messages: [{ role: "user", content: task }],',
        "});",
      ],
      highlight: [2],
    },
  },
  app: {
    purpose: "A product card: logo, name, tagline, tags and its address.",
    whenToUse: "The speaker introduces a tool, app or website by name.",
    seconds: { min: 1.8, typical: 3, max: 6 },
    params: object(
      {
        name: text("The product's name.", 18),
        tagline: text("What it does, in a line.", 40),
        icon,
        logo,
        tags: list(text("A tag.", 10), 1, 3, "Short tags, like 免費 or 開源."),
        url: text("Its address, without https://.", 28),
        accent,
      },
      ["name", "tagline"],
    ),
    example: {
      name: "n8n",
      logo: "n8n",
      tagline: "開源的工作流程自動化工具",
      tags: ["開源", "可自架", "AI 節點"],
      url: "n8n.io",
    },
  },
  logo: {
    purpose: "A brand's logo lands on a lit tile and its name rises beside it.",
    whenToUse: "The first time a brand or tool is named, at the start of the hook.",
    seconds: { min: 1.2, typical: 2, max: 4 },
    params: object(
      {
        name: text("The brand's name.", 18),
        tagline: text("A line under it.", 32),
        icon,
        logo,
        accent,
      },
      ["name"],
    ),
    example: { name: "Claude", logo: "claude", tagline: "Anthropic 的 AI 助手" },
  },
  "icon-grid": {
    purpose: "A grid of icons, each with a label, popping in one after another.",
    whenToUse: "A set of features, integrations or use cases named in quick succession.",
    seconds: { min: 2, typical: 3.5, max: 6 },
    params: object(
      {
        title,
        items: list(
          object({ label: text("Its label.", 10), icon, logo }, ["label"]),
          3,
          9,
          "The items, in reading order.",
        ),
        accent,
      },
      ["items"],
    ),
    example: {
      title: "可以串接的服務",
      items: [
        { label: "Gmail", logo: "gmail" },
        { label: "Notion", logo: "notion" },
        { label: "GitHub", logo: "github" },
        { label: "Telegram", logo: "telegram" },
        { label: "Drive", logo: "googledrive" },
        { label: "Discord", logo: "discord" },
      ],
    },
  },
  definition: {
    purpose: "A dictionary entry: the term, its kind and a one-line definition.",
    whenToUse: "The speaker introduces a term the viewer may not know.",
    seconds: { min: 2.5, typical: 4, max: 7 },
    params: object(
      {
        term: text("The term.", 16),
        kind: text("Its kind or reading, like 名詞 or n.", 12),
        text: text("The definition, in one sentence.", 80),
        accent,
      },
      ["term", "text"],
    ),
    example: {
      term: "AI Agent",
      kind: "名詞",
      text: "能自己規劃步驟、使用工具並完成任務的 AI 程式。",
    },
  },
  highlight: {
    purpose: "A statement in large type with its key phrases swept by a highlighter.",
    whenToUse: "The one line of a section the viewer must remember.",
    seconds: { min: 2, typical: 3.5, max: 6 },
    params: object(
      {
        text: text("The statement.", 60),
        highlights: list(
          text("A phrase from the statement, exactly as written there.", 20),
          1,
          3,
          "The phrases to highlight.",
        ),
        source: text("Where it comes from.", 24),
        accent,
      },
      ["text", "highlights"],
    ),
    example: { text: "AI 不會取代你，但會用 AI 的人會。", highlights: ["會用 AI 的人"] },
  },
  search: {
    purpose: "A search box where the query types out, with results sliding in under it.",
    whenToUse: "The speaker says they looked something up, or what people search for.",
    seconds: { min: 2, typical: 3.5, max: 6 },
    params: object(
      {
        query: text("The query.", 40),
        results: list(
          object({ title: text("The result's title.", 32), url: text("Its address.", 28) }, [
            "title",
            "url",
          ]),
          1,
          3,
          "Results under the box.",
        ),
        accent,
      },
      ["query"],
    ),
    example: {
      query: "如何用 AI 自動剪輯影片",
      results: [
        { title: "免費 AI 剪輯工具完整教學", url: "example.com/ai-edit" },
        { title: "10 分鐘做出短影音", url: "example.com/shorts" },
      ],
    },
  },
  notifications: {
    purpose: "Phone notifications that stack in one after another.",
    whenToUse: "Messages, alerts or results arriving: an agent reporting back, sales coming in.",
    seconds: { min: 2, typical: 3.5, max: 6 },
    params: object(
      {
        items: list(
          object(
            {
              app: text("The app's name.", 14),
              title: text("The notification's title.", 24),
              text: text("Its text.", 48),
              time: text("When, like now or 2m.", 8),
              icon,
              logo,
            },
            ["app", "title", "text"],
          ),
          1,
          4,
          "Top to bottom, newest last.",
        ),
        accent,
      },
      ["items"],
    ),
    example: {
      items: [
        {
          app: "Gmail",
          logo: "gmail",
          title: "新的客戶詢問",
          text: "想了解企業方案的價格",
          time: "2m",
        },
        {
          app: "Agent",
          icon: "bot",
          title: "已自動回覆",
          text: "附上報價單並安排了會議",
          time: "now",
        },
      ],
    },
  },
  "pros-cons": {
    purpose: "Two columns: what is good, with ticks, and what is not, with crosses.",
    whenToUse: "The speaker weighs one option's upsides and downsides.",
    seconds: { min: 2, typical: 4, max: 7 },
    params: object(
      {
        title,
        pros: list(text("An upside.", 20), 1, 4, "The upsides."),
        cons: list(text("A downside.", 20), 1, 4, "The downsides."),
        prosLabel: text("The upsides' heading; 優點 without it.", 10),
        consLabel: text("The downsides' heading; 缺點 without it.", 10),
        accent,
      },
      ["pros", "cons"],
    ),
    example: {
      title: "本地模型",
      pros: ["資料不外流", "不用付 API 費", "可離線使用"],
      cons: ["需要好的顯卡", "能力較弱"],
    },
  },
  ranking: {
    purpose: "A ranked list with numbered rows and bars proportional to each value.",
    whenToUse: "A top three to five: the most used, the fastest, the cheapest.",
    seconds: { min: 2, typical: 3.5, max: 6 },
    params: object(
      {
        title,
        unit: text("The values' unit.", 6),
        items: list(
          object(
            {
              label: text("The entry.", 14),
              value: number("Its value.", { minimum: 0 }),
              icon,
              logo,
            },
            ["label", "value"],
          ),
          2,
          5,
          "The entries, first place first.",
        ),
        accent,
      },
      ["items"],
    ),
    example: {
      title: "最常用的語言（範例）",
      unit: "%",
      items: [
        { label: "JavaScript", value: 62, icon: "code" },
        { label: "Python", value: 51, logo: "python" },
        { label: "TypeScript", value: 38, logo: "typescript" },
      ],
    },
  },
  section: {
    purpose: "A full-screen section card: a big number and the section's name.",
    whenToUse: "The start of each item in a list, or of each part of a longer video.",
    seconds: { min: 1.2, typical: 2, max: 4 },
    params: object(
      {
        title: text("The section's name.", 20),
        index: {
          description: "Its number, from 1; shown large.",
          type: "integer",
          minimum: 1,
          maximum: 99,
        },
        kicker: text("A small line above the name.", 20),
        accent,
      },
      ["title"],
    ),
    example: { title: "自動回覆客戶信件", index: 1, kicker: "用法" },
  },
  table: {
    purpose:
      "A feature table: two or three products across, a few features down, ticks and values.",
    whenToUse: "The speaker compares products feature by feature.",
    seconds: { min: 2.5, typical: 4, max: 7 },
    params: object(
      {
        columns: list(
          object({ name: text("The product.", 12), icon, logo }, ["name"]),
          2,
          3,
          "The products, left to right.",
        ),
        rows: list(
          object(
            {
              label: text("The feature.", 14),
              values: list(
                { oneOf: [{ type: "boolean" }, { type: "string", minLength: 1, maxLength: 8 }] },
                2,
                3,
                "One per column: true for a tick, false for a cross, or a short value.",
              ),
            },
            ["label", "values"],
          ),
          2,
          5,
          "The features, top to bottom.",
        ),
        highlight: index("The column to light, from 1, like the one the speaker recommends."),
        accent,
      },
      ["columns", "rows"],
    ),
    example: {
      columns: [{ name: "工具 A" }, { name: "工具 B" }],
      rows: [
        { label: "免費方案", values: [true, false] },
        { label: "開源", values: [true, false] },
        { label: "每月價格", values: ["$0", "$20"] },
      ],
      highlight: 1,
    },
  },
};

export const cardIds = Object.keys(cards) as CardId[];

export function isCardId(id: string): id is CardId {
  return Object.hasOwn(cards, id);
}
