import type { DefinitionParams } from "../../cards.ts";
import { type CardLayout, COLORS, fit, rgba } from "../../layout.ts";
import { CardFrame, fitBlock, glow, glue, Icon, rise, useBuild } from "./kit.tsx";

/** A dictionary entry: the term rises with its kind beside it, a rule draws under it, and the
 * definition fades in after. */
export function Definition({ params, layout }: { params: DefinitionParams; layout: CardLayout }) {
  const { u, type, box } = layout;
  const accent = params.accent ?? COLORS.accent;
  const build = useBuild(1.3);
  const termSize = fit(params.term, type("display"), box.width * (params.kind ? 0.72 : 0.96));
  const textHeight = box.height - termSize * 1.3 - 12 * u;
  return (
    <CardFrame layout={layout} accent={accent} style={{ justifyContent: "center", gap: 2.6 * u }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 1.4 * u,
          color: accent,
          fontSize: type("small"),
          fontWeight: 700,
          letterSpacing: "0.16em",
          ...rise(build.at(0), u, 2),
        }}
      >
        <Icon name="book-open" size={type("small") * 1.3} color={accent} />
        DEFINITION
      </div>
      <div
        style={{ display: "flex", alignItems: "baseline", gap: 3 * u, ...rise(build.at(0.08), u) }}
      >
        <div
          style={{
            fontSize: termSize,
            fontWeight: 900,
            lineHeight: 1.1,
            whiteSpace: "nowrap",
            textShadow: glow(accent, u, 0.25),
          }}
        >
          {params.term}
        </div>
        {params.kind ? (
          <div
            style={{
              padding: `${0.4 * u}px ${1.8 * u}px`,
              borderRadius: 999,
              fontSize: type("body"),
              fontWeight: 700,
              fontStyle: "italic",
              color: accent,
              border: `${Math.max(1, 0.2 * u)}px solid ${rgba(accent, 0.6)}`,
              whiteSpace: "nowrap",
            }}
          >
            {params.kind}
          </div>
        ) : null}
      </div>
      <div
        style={{
          height: Math.max(2, 0.5 * u),
          width: "100%",
          background: `linear-gradient(90deg, ${accent}, ${rgba(accent, 0)})`,
          transform: `scaleX(${build.at(0.3, 0.6)})`,
          transformOrigin: "left",
        }}
      />
      <div
        style={{
          fontSize: fitBlock(params.text, type("item") * 1.2, box.width, textHeight, 1.45),
          fontWeight: 500,
          lineHeight: 1.45,
          wordBreak: "keep-all",
          color: rgba(COLORS.paper, 0.9),
          ...rise(build.at(0.5, 0.6), u, 2),
        }}
      >
        {glue(params.text)}
      </div>
    </CardFrame>
  );
}
