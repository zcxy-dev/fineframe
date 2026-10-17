import type { LineChartParams } from "../../cards.ts";
import { type CardLayout, COLORS, fit, rgba } from "../../layout.ts";
import { decimalsOf } from "./bar-chart.tsx";
import { CardFrame, count, DIM, FAINT, glow, Heading, LINE, rise, useBuild } from "./kit.tsx";

/** The line draws left to right through the series with the area under it filling behind, and
 * ends on a lit dot with the last value counting up beside it. */
export function LineChart({ params, layout }: { params: LineChartParams; layout: CardLayout }) {
  const { u, type, box } = layout;
  const accent = params.accent ?? COLORS.accent;
  const { points } = params;
  const values = points.map((point) => point.value);
  const build = useBuild(1.8);
  const drawn = build.at(0.2, 1.4);
  const titleSpace = params.title ? type("heading") * 1.2 + 4 * u : 0;
  const labelSize = type("small");
  const valueSize = type("heading") * 0.8;
  const width = box.width;
  const height = box.height - titleSpace - labelSize * 2;
  const top = valueSize * 1.4;
  const right = Math.min(width * 0.2, valueSize * 3);
  const hi = Math.max(...values);
  const low = Math.min(...values);
  // A baseline at zero unless the series sits high above it, where zero would flatten it.
  const lo = low >= 0 && low < hi * 0.5 ? 0 : low - (hi - low) * 0.15;
  const x = (k: number) => (k / (points.length - 1)) * (width - right);
  const y = (v: number) => top + (1 - (v - lo) / (hi - lo || 1)) * (height - top);
  const path = points.map((p, k) => `${k === 0 ? "M" : "L"}${x(k)},${y(p.value)}`).join(" ");
  const area = `${path} L${x(points.length - 1)},${height} L0,${height} Z`;
  const lastX = x(points.length - 1);
  const lastY = y(values[values.length - 1] as number);
  const decimals = decimalsOf(values);
  const unit = params.unit ? ` ${params.unit}` : "";
  // Labels as many as fit under the plot, spread evenly.
  const every = Math.ceil(
    points.length / Math.max(2, Math.floor((width - right) / (labelSize * 4))),
  );
  const stroke = Math.max(2, 0.8 * u);
  return (
    <CardFrame layout={layout} accent={accent}>
      <Heading text={params.title} layout={layout} progress={build.at(0)} />
      <div style={{ position: "relative", flex: 1 }}>
        <svg
          width={width}
          height={height}
          style={{ overflow: "visible", display: "block" }}
          aria-hidden
        >
          <defs>
            <linearGradient id="fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={accent} stopOpacity="0.38" />
              <stop offset="1" stopColor={accent} stopOpacity="0" />
            </linearGradient>
            <clipPath id="reveal">
              <rect
                x={-stroke}
                y={-height}
                width={(lastX + 2 * stroke) * drawn}
                height={height * 3}
              />
            </clipPath>
          </defs>
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <line
              key={f}
              x1={0}
              x2={width - right}
              y1={top + f * (height - top)}
              y2={top + f * (height - top)}
              stroke={LINE}
              strokeWidth={Math.max(1, 0.15 * u)}
            />
          ))}
          <g clipPath="url(#reveal)">
            <path d={area} fill="url(#fill)" />
            <path
              d={path}
              fill="none"
              stroke={accent}
              strokeWidth={stroke}
              strokeLinejoin="round"
              strokeLinecap="round"
              style={{ filter: `drop-shadow(0 0 ${1.2 * u}px ${rgba(accent, 0.7)})` }}
            />
            {points.map((p, k) => (
              <circle
                key={p.label}
                cx={x(k)}
                cy={y(p.value)}
                r={stroke * 0.9}
                fill={COLORS.ink}
                stroke={accent}
                strokeWidth={stroke * 0.6}
              />
            ))}
          </g>
          <circle
            cx={lastX}
            cy={lastY}
            r={stroke * 2.2 * build.at(1.4, 0.4)}
            fill={accent}
            style={{ filter: `drop-shadow(0 0 ${1.5 * u}px ${accent})` }}
          />
        </svg>
        <div
          style={{
            position: "absolute",
            left: lastX,
            top: lastY - valueSize * 1.5,
            transform: "translateX(-60%)",
            fontSize: fit(`${count(hi, 1, decimals)}${unit}`, valueSize, right * 1.6),
            fontWeight: 900,
            fontVariantNumeric: "tabular-nums",
            color: accent,
            textShadow: glow(accent, u, 0.6),
            whiteSpace: "nowrap",
            ...rise(build.at(1.2, 0.4), u, 2),
          }}
        >
          {count(values[values.length - 1] as number, build.linear(0.2, 1.4), decimals)}
          {unit}
        </div>
        {points.map((p, k) =>
          k % every === 0 || k === points.length - 1 ? (
            <div
              key={p.label}
              style={{
                position: "absolute",
                left: x(k),
                top: height + labelSize * 0.6,
                transform: "translateX(-50%)",
                fontSize: labelSize,
                fontWeight: 700,
                color: k === points.length - 1 ? DIM : FAINT,
                whiteSpace: "nowrap",
                opacity: build.at(0.2 + (k / points.length) * 1.4, 0.3),
              }}
            >
              {p.label}
            </div>
          ) : null,
        )}
      </div>
    </CardFrame>
  );
}
