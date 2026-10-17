import type { BeforeAfterParams } from "../../cards.ts";
import { CARD_COLORS, type CardLayout, COLORS, rgba } from "../../layout.ts";
import {
  CardFrame,
  DIM,
  fitBlock,
  glass,
  glue,
  Heading,
  Icon,
  rise,
  Tile,
  useBuild,
} from "./kit.tsx";

/** The before state appears muted, an arrow draws toward the after state, and the after state
 * lands lit in the accent. Side by side, or one above the other when the card is narrow. */
export function BeforeAfter({ params, layout }: { params: BeforeAfterParams; layout: CardLayout }) {
  const { u, type, box } = layout;
  const accent = params.accent ?? COLORS.accent;
  const build = useBuild(1.5);
  const row = layout.ratio > 1.05;
  const arrow = 10 * u;
  const titleSpace = params.title ? type("heading") * 1.2 + 4 * u : 0;
  const panelWidth = row ? (box.width - arrow - 4 * u) / 2 : box.width;
  const panelHeight = row
    ? Math.min(box.height - titleSpace, 70 * u)
    : (box.height - titleSpace - arrow - 4 * u) / 2;
  const states = [
    {
      state: params.before,
      label: params.before.label ?? "之前",
      color: CARD_COLORS.bad,
      p: build.at(0.05),
    },
    { state: params.after, label: params.after.label ?? "之後", color: accent, p: build.at(0.75) },
  ];
  const drawn = build.at(0.4, 0.4);
  const tile = Math.min(16 * u, panelHeight * 0.3);
  return (
    <CardFrame layout={layout} accent={accent}>
      <Heading text={params.title} layout={layout} progress={build.at(0)} />
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: row ? "row" : "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 2 * u,
        }}
      >
        {states.map(({ state, label, color, p }, k) => {
          const after = k === 1;
          const textWidth = panelWidth - 8 * u;
          const textHeight = panelHeight - tile - 16 * u;
          return [
            k === 1 ? (
              <div key="arrow" style={{ opacity: drawn, transform: `scale(${0.6 + 0.4 * drawn})` }}>
                <Icon
                  name={row ? "arrow-right" : "arrow-down"}
                  size={arrow}
                  color={accent}
                  stroke={2.6}
                />
              </div>
            ) : null,
            <div
              key={label}
              style={{
                ...glass(u, after ? 1.5 : 0.8),
                width: panelWidth,
                height: panelHeight,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 2.2 * u,
                padding: 4 * u,
                textAlign: "center",
                ...rise(p, u),
                ...(after
                  ? {
                      border: `${Math.max(1, 0.3 * u)}px solid ${rgba(accent, 0.75)}`,
                      boxShadow: `0 0 ${6 * u}px ${rgba(accent, 0.3)}`,
                    }
                  : {}),
              }}
            >
              <div
                style={{
                  padding: `${0.5 * u}px ${2 * u}px`,
                  borderRadius: 999,
                  fontSize: type("small"),
                  fontWeight: 900,
                  letterSpacing: "0.12em",
                  color: after ? COLORS.ink : color,
                  background: after ? accent : rgba(color, 0.16),
                }}
              >
                {label}
              </div>
              {state.icon || state.logo ? (
                <Tile
                  icon={state.icon}
                  logo={state.logo}
                  size={tile}
                  color={after ? accent : "#8a8f98"}
                  u={u}
                />
              ) : null}
              <div
                style={{
                  fontSize: fitBlock(state.text, type("item") * 1.1, textWidth, textHeight, 1.3),
                  fontWeight: after ? 900 : 700,
                  lineHeight: 1.3,
                  color: after ? COLORS.paper : DIM,
                  textWrap: "balance",
                  wordBreak: "keep-all",
                  maxWidth: textWidth,
                }}
              >
                {glue(state.text)}
              </div>
            </div>,
          ];
        })}
      </div>
    </CardFrame>
  );
}
