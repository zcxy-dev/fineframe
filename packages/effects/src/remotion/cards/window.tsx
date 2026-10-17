import type { CSSProperties, ReactNode } from "react";
import { type CardLayout, COLORS, rgba } from "../../layout.ts";
import { FAINT, monoFamily } from "./kit.tsx";

/** The window chrome of the terminal and the editor: a dark pane with three dots and a title. */
export function Window(props: {
  layout: CardLayout;
  title?: string;
  width: number;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const { u, type } = props.layout;
  const bar = 7 * u;
  return (
    <div
      style={{
        width: props.width,
        maxHeight: "100%",
        overflow: "hidden",
        borderRadius: 2.2 * u,
        background: rgba("#0a0b0e", 0.94),
        border: `${Math.max(1, 0.18 * u)}px solid ${rgba(COLORS.paper, 0.14)}`,
        boxShadow: `0 ${2 * u}px ${7 * u}px ${rgba("#000000", 0.6)}`,
        ...props.style,
      }}
    >
      <div
        style={{
          height: bar,
          display: "flex",
          alignItems: "center",
          gap: 1.2 * u,
          padding: `0 ${2.4 * u}px`,
          background: rgba(COLORS.paper, 0.05),
          borderBottom: `${Math.max(1, 0.18 * u)}px solid ${rgba(COLORS.paper, 0.08)}`,
        }}
      >
        {["#ff5f57", "#febc2e", "#28c840"].map((color) => (
          <div
            key={color}
            style={{ width: 1.8 * u, height: 1.8 * u, borderRadius: "50%", background: color }}
          />
        ))}
        <div
          style={{
            flex: 1,
            textAlign: "center",
            marginRight: 6 * u,
            fontFamily: monoFamily,
            fontSize: type("small"),
            color: FAINT,
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          {props.title}
        </div>
      </div>
      {props.children}
    </div>
  );
}
