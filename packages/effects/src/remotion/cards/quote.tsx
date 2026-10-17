import type { QuoteParams } from "../../cards.ts";
import { type CardLayout, COLORS } from "../../layout.ts";
import {
  brandColor,
  CardFrame,
  DIM,
  fitBlock,
  glow,
  glue,
  Icon,
  rise,
  Tile,
  useBuild,
} from "./kit.tsx";

/** The quote's words: each CJK character on its own, other runs up to their spaces. */
function words(text: string): string[] {
  return text.match(/[\u{2e80}-\u{10ffff}]|[^\s\u{2e80}-\u{10ffff}]+\s*|\s+/gu) ?? [text];
}

/** A quotation mark draws in, the words fade up one after another, and the author follows. */
export function Quote({ params, layout }: { params: QuoteParams; layout: CardLayout }) {
  const { u, type, box } = layout;
  const accent = params.accent ?? COLORS.accent;
  const tokens = words(glue(params.text));
  const reading = Math.min(1.6, tokens.length * 0.05);
  const build = useBuild(0.3 + reading + 0.5);
  const mark = Math.min(16 * u, box.height * 0.16);
  const size = fitBlock(
    params.text,
    type("heading") * 1.15,
    box.width * 0.96,
    box.height - mark - 18 * u,
    1.35,
  );
  const color = params.logo ? brandColor(params.logo, accent) : accent;
  return (
    <CardFrame layout={layout} accent={accent} style={{ justifyContent: "center", gap: 3 * u }}>
      <div style={{ ...rise(build.at(0), u), marginBottom: -mark * 0.2 }}>
        <Icon name="quote" size={mark} color={accent} stroke={2.4} />
      </div>
      <div
        style={{
          fontSize: size,
          fontWeight: 900,
          lineHeight: 1.35,
          textWrap: "balance",
          wordBreak: "keep-all",
        }}
      >
        {tokens.map((token, k) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: words keep their places in the quote
            key={k}
            style={{ opacity: 0.12 + 0.88 * build.at(0.3 + (k / tokens.length) * reading, 0.3) }}
          >
            {token}
          </span>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2.4 * u,
          ...rise(build.at(0.3 + reading), u),
        }}
      >
        {params.icon || params.logo ? (
          <Tile icon={params.icon} logo={params.logo} size={10 * u} color={color} u={u} />
        ) : (
          <div
            style={{
              width: 6 * u,
              height: 0.6 * u,
              background: accent,
              boxShadow: glow(accent, u, 0.5),
            }}
          />
        )}
        <div>
          <div style={{ fontSize: type("item"), fontWeight: 700 }}>{params.author}</div>
          {params.role ? (
            <div style={{ fontSize: type("body"), fontWeight: 500, color: DIM }}>{params.role}</div>
          ) : null}
        </div>
      </div>
    </CardFrame>
  );
}
