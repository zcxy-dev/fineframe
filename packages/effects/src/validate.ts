import { describeErrors, type Overlay, SchemaError, TICKS_PER_SECOND } from "@video-editor/schema";
import { Ajv2020 } from "ajv/dist/2020.js";
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
