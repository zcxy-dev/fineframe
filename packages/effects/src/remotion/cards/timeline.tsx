import type { TimelineParams } from "../../cards.ts";
import { type CardLayout, COLORS, fit, rgba } from "../../layout.ts";
import { CardFrame, DIM, glow, Heading, LINE, rise, useBuild } from "./kit.tsx";

/** A line draws through the events, each dot lighting as the line reaches it with its date and
 * label rising beside it; one event, the last unless `active` says otherwise, stays lit. Across
 * the card, or down it when the card is narrow. */
export function Timeline({ params, layout }: { params: TimelineParams; layout: CardLayout }) {
  const { u, type, box } = layout;
  const accent = params.accent ?? COLORS.accent;
  const { events } = params;
  const active = (params.active ?? events.length) - 1;
  const build = useBuild(0.3 + events.length * 0.3 + 0.3);
  const row = layout.ratio > 1.1;
  const titleSpace = params.title ? type("heading") * 1.2 + 4 * u : 0;
  const n = events.length;
  const drawn = build.linear(0.25, n * 0.3);
  const thickness = Math.max(2, 0.5 * u);
  const dot = 4 * u;
  // Each event sits at the middle of its share of the line.
  const at = (k: number) => (k + 0.5) / n;
  const room = row ? box.width / n - 2 * u : box.width - 14 * u;
  return (
    <CardFrame layout={layout} accent={accent}>
      <Heading text={params.title} layout={layout} progress={build.at(0)} />
      <div style={{ flex: 1, position: "relative", maxHeight: box.height - titleSpace }}>
        <div
          style={{
            position: "absolute",
            background: LINE,
            ...(row
              ? { left: 0, right: 0, top: "50%", height: thickness, marginTop: -thickness / 2 }
              : { top: 0, bottom: 0, left: dot, width: thickness, marginLeft: -thickness / 2 }),
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `linear-gradient(${row ? "90deg" : "180deg"}, ${rgba(accent, 0.3)}, ${accent})`,
              transform: row ? `scaleX(${drawn})` : `scaleY(${drawn})`,
              transformOrigin: row ? "left" : "top",
              boxShadow: glow(accent, u, 0.4),
            }}
          />
        </div>
        {events.map((event, k) => {
          const reached = build.at(0.25 + at(k) * n * 0.3, 0.4);
          const lit = k === active;
          const size = lit ? dot * 1.5 : dot;
          const position = `${at(k) * 100}%`;
          return (
            <div key={`${event.date}${event.label}`}>
              <div
                style={{
                  position: "absolute",
                  width: size,
                  height: size,
                  marginLeft: -size / 2,
                  marginTop: -size / 2,
                  borderRadius: "50%",
                  background: lit ? accent : COLORS.paper,
                  border: `${0.6 * u}px solid ${COLORS.ink}`,
                  boxShadow: lit ? glow(accent, u) : "none",
                  transform: `scale(${reached})`,
                  ...(row ? { left: position, top: "50%" } : { left: dot, top: position }),
                }}
              />
              <div
                style={{
                  position: "absolute",
                  display: "flex",
                  flexDirection: "column",
                  ...(row
                    ? {
                        left: position,
                        width: room,
                        marginLeft: -room / 2,
                        alignItems: "center",
                        textAlign: "center",
                        ...(k % 2 === 0
                          ? { bottom: "50%", paddingBottom: 4 * u }
                          : { top: "50%", paddingTop: 4 * u }),
                      }
                    : { left: dot * 2 + 3 * u, top: position, transform: "translateY(-50%)" }),
                }}
              >
                <div style={rise(reached, u, 2)}>
                  <div
                    style={{
                      fontSize: fit(event.date, type("heading") * 0.8, room),
                      fontWeight: 900,
                      color: lit ? accent : COLORS.paper,
                      textShadow: lit ? glow(accent, u, 0.6) : "none",
                      lineHeight: 1.1,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {event.date}
                  </div>
                  <div
                    style={{
                      marginTop: 0.6 * u,
                      fontSize: fit(event.label, type("item"), room),
                      fontWeight: 700,
                      color: lit ? COLORS.paper : DIM,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {event.label}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </CardFrame>
  );
}
