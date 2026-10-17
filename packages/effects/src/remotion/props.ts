import type { CardId, CardParams } from "../cards.ts";
import type { TemplateId, TemplateParams } from "../catalog.ts";
import type { Aspect, Placement } from "../layout.ts";

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

/** The composition every card renders from. */
export const CARD_COMPOSITION = "card";

/** What the renderer passes for one card: its size is the frame's for a full card, the panel's
 * for a panel. */
export type CardProps = {
  card: CardId;
  params: CardParams[CardId];
  placement: Placement;
  aspect: Aspect;
  width: number;
  height: number;
  fps: number;
  frames: number;
};
