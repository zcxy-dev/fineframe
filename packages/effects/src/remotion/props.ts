import type { TemplateId, TemplateParams } from "../catalog.ts";
import type { Aspect } from "../layout.ts";

/** The composition every overlay renders from. */
export const COMPOSITION = "overlay";

/** What the renderer passes for one overlay. A type, not an interface: Remotion's props must be
 * a plain record. */
export type OverlayProps = {
  template: TemplateId;
  params: TemplateParams[TemplateId];
  aspect: Aspect;
  width: number;
  height: number;
  /** Frames per second, which Remotion takes as one number. */
  fps: number;
  frames: number;
};
