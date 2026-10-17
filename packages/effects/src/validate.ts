import { describeErrors, type Overlay, SchemaError, TICKS_PER_SECOND } from "@video-editor/schema";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  type CardId,
  cardIds,
  cards,
  type HighlightParams,
  isCardId,
  type TableParams,
} from "./cards.ts";
import {
  type CalloutParams,
  type ChapterParams,
  catalog,
  isTemplateId,
  templateIds,
} from "./catalog.ts";

const ajv = new Ajv2020({ allErrors: true });
const validators = new Map(templateIds.map((id) => [id, ajv.compile(catalog[id].params)]));
// Normalised coordinates are floats, so 0.2 + 0.8 may land a hair above 1.
const EDGE = 1 + 1e-9;

/** Every problem with these overlays, one per line with its JSON Pointer: unknown templates,
 * params their template does not take, and durations outside its range. */
export function overlayProblems(overlays: Overlay[]): string[] {
  const problems: string[] = [];
  for (const [i, overlay] of overlays.entries()) {
    const path = `/overlays/${i}`;
    const id = overlay.template;
    if (!isTemplateId(id)) {
      problems.push(`${path}/template: no template ${id}; one of ${templateIds.join(", ")}`);
      continue;
    }
    const validate = validators.get(id);
    if (validate && !validate(overlay.params)) {
      problems.push(describeErrors(validate.errors ?? [], `${path}/params`));
    } else if (id === "callout") {
      const { rect } = overlay.params as unknown as CalloutParams;
      if (rect.x + rect.w > EDGE || rect.y + rect.h > EDGE) {
        problems.push(`${path}/params/rect: x + w and y + h may not exceed 1`);
      }
    } else if (id === "chapter") {
      const { index, total } = overlay.params as unknown as ChapterParams;
      if (index > total) problems.push(`${path}/params/index: ${index} is past total ${total}`);
    }
    const { min, max } = catalog[id].seconds;
    const seconds = overlay.duration / TICKS_PER_SECOND;
    if (seconds < min || seconds > max) {
      problems.push(`${path}/duration: ${seconds} s, outside ${id}'s ${min} to ${max} s`);
    }
  }
  return problems;
}

/** Throws a SchemaError listing every problem overlayProblems finds. */
export function validateOverlays(overlays: Overlay[]): void {
  const problems = overlayProblems(overlays);
  if (problems.length > 0) throw new SchemaError(problems.join("\n"));
}

/** One card to check: its id, params and, when it is placed, its length in seconds. */
export interface CardEntry {
  card: string;
  params: object;
  seconds?: number;
}

const cardValidators = new Map(cardIds.map((id) => [id, ajv.compile(cards[id].params)]));

/** Every problem with these cards, one per line with its JSON Pointer under `path`: unknown
 * cards, params their card does not take, indexes past their lists and lengths outside the
 * card's range. */
export function cardProblems(entries: CardEntry[], path = "/cards"): string[] {
  const problems: string[] = [];
  for (const [i, entry] of entries.entries()) {
    const at = `${path}/${i}`;
    const id = entry.card;
    if (!isCardId(id)) {
      problems.push(`${at}/card: no card ${id}; one of ${cardIds.join(", ")}`);
      continue;
    }
    const validate = cardValidators.get(id);
    if (validate && !validate(entry.params)) {
      problems.push(describeErrors(validate.errors ?? [], `${at}/params`));
    } else {
      problems.push(...indexProblems(id, entry.params, `${at}/params`));
    }
    const { min, max } = cards[id].seconds;
    if (entry.seconds !== undefined && (entry.seconds < min || entry.seconds > max)) {
      problems.push(`${at}/seconds: ${entry.seconds} s, outside ${id}'s ${min} to ${max} s`);
    }
  }
  return problems;
}

/** What a schema cannot say: indexes within their lists, and highlights found in their text. */
function indexProblems(id: CardId, params: object, path: string): string[] {
  const problems: string[] = [];
  const within = (field: string, value: number | undefined, length: number) => {
    if (value !== undefined && value > length) {
      problems.push(`${path}/${field}: ${value} is past the last of ${length}`);
    }
  };
  const p = params as Record<string, unknown>;
  const length = (field: string) => (p[field] as unknown[]).length;
  if (id === "list") within("active", p.active as number | undefined, length("items"));
  if (id === "timeline") within("active", p.active as number | undefined, length("events"));
  if (id === "bar-chart") within("highlight", p.highlight as number | undefined, length("bars"));
  if (id === "checklist") within("checked", p.checked as number | undefined, length("items"));
  if (id === "code") {
    for (const [k, line] of ((p.highlight ?? []) as number[]).entries()) {
      within(`highlight/${k}`, line, length("lines"));
    }
  }
  if (id === "highlight") {
    const { text, highlights } = params as HighlightParams;
    // Each phrase is highlighted at its first place, so two may not overlap there.
    const spans: [number, number][] = [];
    for (const [k, phrase] of highlights.entries()) {
      const at = text.indexOf(phrase);
      if (at < 0) problems.push(`${path}/highlights/${k}: not in the text`);
      else if (spans.some(([from, to]) => at < to && from < at + phrase.length)) {
        problems.push(`${path}/highlights/${k}: overlaps an earlier highlight`);
      } else spans.push([at, at + phrase.length]);
    }
  }
  if (id === "table") {
    const { columns, rows } = params as TableParams;
    within("highlight", (params as TableParams).highlight, columns.length);
    for (const [k, row] of rows.entries()) {
      if (row.values.length !== columns.length) {
        problems.push(
          `${path}/rows/${k}/values: ${row.values.length} values for ${columns.length} columns`,
        );
      }
    }
  }
  return problems;
}

/** Throws a SchemaError listing every problem cardProblems finds. */
export function validateCards(entries: CardEntry[], path?: string): void {
  const problems = cardProblems(entries, path);
  if (problems.length > 0) throw new SchemaError(problems.join("\n"));
}
