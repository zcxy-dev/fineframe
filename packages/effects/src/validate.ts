import {
  describeErrors,
  type Graphic,
  type Overlay,
  type Project,
  SchemaError,
  TICKS_PER_SECOND,
} from "@video-editor/schema";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  type CalloutParams,
  type ChapterParams,
  catalog,
  isTemplateId,
  templateIds,
} from "./catalog.ts";
import { GRAPHIC_SECONDS, isOverlayLayout } from "./graphics.ts";
import { markupProblem } from "./page.ts";

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

/** Every problem with these graphics, one per line with its JSON Pointer: markup that loads
 * or runs anything, a label or lower third with no box, a panel outside 9:16, and lengths past
 * their layout's longest. */
export function graphicProblems(
  graphics: Graphic[],
  aspect: Project["output"]["aspect"],
): string[] {
  const problems: string[] = [];
  for (const [i, graphic] of graphics.entries()) {
    const path = `/graphics/${i}`;
    const unsafe = markupProblem(graphic.html, graphic.css);
    if (unsafe) problems.push(`${path}: ${unsafe}`);
    if (isOverlayLayout(graphic.layout) && !graphic.box) {
      problems.push(`${path}/box: a ${graphic.layout} needs the region it is drawn in`);
    }
    if (graphic.layout === "panel" && aspect !== "9:16") {
      problems.push(`${path}/layout: a panel splits only a 9:16 frame`);
    }
    if (
      graphic.box &&
      (graphic.box.x + graphic.box.w > EDGE || graphic.box.y + graphic.box.h > EDGE)
    ) {
      problems.push(`${path}/box: x + w and y + h may not exceed 1`);
    }
    const { max } = GRAPHIC_SECONDS[graphic.layout];
    const seconds = graphic.duration / TICKS_PER_SECOND;
    if (seconds > max + 1e-6) {
      problems.push(`${path}/duration: ${seconds} s, longer than a ${graphic.layout}'s ${max} s`);
    }
  }
  return problems;
}

/** Throws a SchemaError listing every problem graphicProblems finds. */
export function validateGraphics(graphics: Graphic[], aspect: Project["output"]["aspect"]): void {
  const problems = graphicProblems(graphics, aspect);
  if (problems.length > 0) throw new SchemaError(problems.join("\n"));
}
