import type { CSSProperties } from "react";
import type { ChatParams } from "../../cards.ts";
import { type CardLayout, COLORS, ems, rgba } from "../../layout.ts";
import {
  brandColor,
  CardFrame,
  Caret,
  DIM,
  glass,
  Mark,
  rise,
  Tile,
  typed,
  useBuild,
} from "./kit.tsx";

/** How long each message takes in the build: the user's pops in, the assistant's shows typing
 * dots and then streams in. Seconds. */
function schedule(messages: ChatParams["messages"]) {
  let at = 0.3;
  return messages.map((message) => {
    const start = at;
    const typing = message.from === "ai" ? 0.45 : 0;
    const stream = message.from === "ai" ? Math.min(1.8, [...message.text].length / 30) : 0;
    at += typing + stream + 0.35;
    return { start, typing, stream };
  });
}

/** A chat window: the user's messages pop in on the right, and each reply shows typing dots on
 * the left and then streams in behind a cursor. */
export function Chat({ params, layout }: { params: ChatParams; layout: CardLayout }) {
  const { u, type, box } = layout;
  const accent = params.accent ?? COLORS.accent;
  const steps = schedule(params.messages);
  const last = steps[steps.length - 1];
  const build = useBuild(last ? last.start + last.typing + last.stream : 1);
  const windowWidth = Math.min(box.width, Math.max(box.height * 2.0, 100 * u));
  const header = 11 * u;
  const bubbleWidth = windowWidth * 0.78 - 6 * u;
  // The largest size at which every message fits the window, wrapped in its bubble.
  const room = box.height - header - 6 * u;
  let size = type("item") * 1.25;
  const height = (s: number) =>
    params.messages.reduce(
      (sum, m) => sum + Math.ceil((ems(m.text) * s * 1.1) / bubbleWidth) * s * 1.42 + 5.6 * u,
      0,
    );
  while (size > 2 * u && height(size) > room) size *= 0.95;
  const bubble = (user: boolean): CSSProperties => ({
    maxWidth: bubbleWidth,
    padding: `${1.4 * u}px ${2.4 * u}px`,
    borderRadius: 2.4 * u,
    fontSize: size,
    fontWeight: 500,
    lineHeight: 1.42,
    background: user ? rgba(accent, 0.22) : rgba(COLORS.paper, 0.07),
    border: `${Math.max(1, 0.18 * u)}px solid ${user ? rgba(accent, 0.45) : rgba(COLORS.paper, 0.1)}`,
  });
  const mark = brandColor(params.logo ?? "claude", accent);
  const markColor = params.logo ? mark : accent;
  return (
    <CardFrame
      layout={layout}
      accent={accent}
      style={{ alignItems: "center", justifyContent: "center" }}
    >
      <div
        style={{
          ...glass(u, 1.2),
          width: windowWidth,
          maxHeight: box.height,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          ...rise(build.at(0, 0.4), u, 2),
        }}
      >
        <div
          style={{
            height: header,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 2 * u,
            padding: `0 ${3 * u}px`,
            borderBottom: `${Math.max(1, 0.18 * u)}px solid ${rgba(COLORS.paper, 0.1)}`,
          }}
        >
          <Tile
            icon={params.icon ?? (params.logo ? undefined : "bot")}
            logo={params.logo}
            size={6.4 * u}
            color={markColor}
            u={u}
          />
          <div style={{ fontSize: type("body"), fontWeight: 700 }}>{params.app ?? "AI"}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2.4 * u, padding: 3 * u }}>
          {params.messages.map((message, k) => {
            const step = steps[k] as (typeof steps)[number];
            const shown = build.at(step.start, 0.3);
            const user = message.from === "user";
            const streamed = build.linear(step.start + step.typing, step.stream);
            const typing = !user && streamed <= 0;
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: messages are positions in a fixed script
                key={k}
                style={{
                  display: "flex",
                  justifyContent: user ? "flex-end" : "flex-start",
                  alignItems: "flex-start",
                  gap: 1.6 * u,
                  ...rise(shown, u, 2),
                }}
              >
                {user ? null : (
                  <div style={{ marginTop: 0.8 * u }}>
                    <Mark
                      icon={params.icon ?? (params.logo ? undefined : "bot")}
                      logo={params.logo}
                      size={4.4 * u}
                      color={markColor}
                    />
                  </div>
                )}
                {/* An unseen copy of the whole message holds its final size, so the window keeps
                    its layout while the reply streams in and later messages wait their turn. */}
                <div style={{ position: "relative" }}>
                  <div style={{ ...bubble(user), visibility: "hidden" }}>{message.text}</div>
                  <div
                    style={{
                      ...bubble(user),
                      position: "absolute",
                      top: 0,
                      [user ? "right" : "left"]: 0,
                      width: "max-content",
                    }}
                  >
                    {typing ? (
                      <Dots seconds={build.seconds} size={size} />
                    ) : user ? (
                      message.text
                    ) : (
                      <>
                        {typed(message.text, streamed)}
                        {streamed < 1 ? (
                          <Caret seconds={build.seconds} color={DIM} height={size} />
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </CardFrame>
  );
}

/** Three dots that pulse in turn while the assistant is typing. */
function Dots({ seconds, size }: { seconds: number; size: number }) {
  return (
    <span style={{ display: "inline-flex", gap: size * 0.3, padding: `${size * 0.25}px 0` }}>
      {[0, 1, 2].map((k) => (
        <span
          key={k}
          style={{
            width: size * 0.36,
            height: size * 0.36,
            borderRadius: "50%",
            background: COLORS.paper,
            opacity: 0.3 + 0.7 * Math.max(0, Math.sin((seconds * 6 - k) % (2 * Math.PI))),
          }}
        />
      ))}
    </span>
  );
}
