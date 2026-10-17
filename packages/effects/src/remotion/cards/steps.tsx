import { Fragment } from "react";
import type { StepsParams } from "../../cards.ts";
import { type CardLayout, COLORS, fit, rgba } from "../../layout.ts";
import { brandColor, CardFrame, glow, Heading, LINE, rise, Tile, useBuild } from "./kit.tsx";

/** Each step's tile lands in turn and the connector to the next draws after it, with a light
 * running along it: across the card, or down it when the card is narrow. */
export function Steps({ params, layout }: { params: StepsParams; layout: CardLayout }) {
  const { u, type, box } = layout;
  const accent = params.accent ?? COLORS.accent;
  const { steps } = params;
  const per = 0.32;
  const build = useBuild(0.3 + steps.length * per + 0.3);
  const row = layout.ratio > 1.1;
  const titleSpace = params.title ? type("heading") * 1.2 + 4 * u : 0;
  const room = box.height - titleSpace;
  const tile = row
    ? Math.min(22 * u, room * 0.5, (box.width / steps.length) * 0.55)
    : Math.min(18 * u, (room / steps.length) * 0.62);
  const labelWidth = row ? box.width / steps.length - 2 * u : box.width - tile - 6 * u;
  const thickness = Math.max(2, 0.6 * u);
  return (
    <CardFrame layout={layout} accent={accent}>
      <Heading text={params.title} layout={layout} progress={build.at(0)} />
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: row ? "row" : "column",
          alignItems: row ? "flex-start" : "stretch",
          justifyContent: "center",
          paddingTop: row ? Math.max(0, (room - tile - type("item") * 2) / 2) : 0,
        }}
      >
        {steps.map((step, k) => {
          const landed = build.at(0.2 + k * per, 0.4);
          const drawn = build.linear(0.2 + k * per + 0.18, per);
          const color = step.logo ? brandColor(step.logo, accent) : accent;
          const node = (
            <div
              style={{
                display: "flex",
                flexDirection: row ? "column" : "row",
                alignItems: "center",
                gap: row ? 2 * u : 3 * u,
                width: row ? tile : undefined,
                ...rise(landed, u),
              }}
            >
              {step.icon || step.logo ? (
                <Tile icon={step.icon} logo={step.logo} size={tile} color={color} u={u} />
              ) : (
                <div
                  style={{
                    width: tile,
                    height: tile,
                    flexShrink: 0,
                    borderRadius: tile * 0.26,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: tile * 0.46,
                    fontWeight: 900,
                    color: COLORS.ink,
                    background: accent,
                    boxShadow: glow(accent, u, 0.6),
                  }}
                >
                  {k + 1}
                </div>
              )}
              <div
                style={{
                  width: row ? labelWidth : undefined,
                  textAlign: row ? "center" : "left",
                  fontSize: fit(step.label, type("item"), labelWidth),
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                }}
              >
                {step.label}
              </div>
            </div>
          );
          const connector =
            k < steps.length - 1 ? (
              <div
                style={{
                  position: "relative",
                  flex: 1,
                  minWidth: row ? 4 * u : undefined,
                  minHeight: row ? undefined : 2 * u,
                  width: row ? undefined : thickness,
                  height: row ? thickness : undefined,
                  marginTop: row ? tile / 2 - thickness / 2 : 0,
                  marginLeft: row ? 1.5 * u : tile / 2 - thickness / 2,
                  marginRight: row ? 1.5 * u : 0,
                  background: LINE,
                  borderRadius: thickness,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: `linear-gradient(${row ? "90deg" : "180deg"}, ${rgba(accent, 0.4)}, ${accent})`,
                    transform: row ? `scaleX(${drawn})` : `scaleY(${drawn})`,
                    transformOrigin: row ? "left" : "top",
                    boxShadow: glow(accent, u, 0.4),
                  }}
                />
              </div>
            ) : null;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: steps keep their places in the flow
            <Fragment key={k}>
              {node}
              {connector}
            </Fragment>
          );
        })}
      </div>
    </CardFrame>
  );
}
