// Remotion's entry point, which its bundler builds into the page each overlay and card is
// rendered from. Code under remotion/ runs in the browser, so it imports only types from the
// Node side.

import { Composition, registerRoot } from "remotion";
import { Card } from "./Card.tsx";
import { Overlay } from "./Overlay.tsx";
import { CARD_COMPOSITION, type CardProps, COMPOSITION, type OverlayProps } from "./props.ts";

const defaults: OverlayProps = {
  template: "title",
  params: { text: "標題" },
  aspect: "16:9",
  width: 1920,
  height: 1080,
  fps: 30,
  frames: 90,
};

const cardDefaults: CardProps = {
  card: "section",
  params: { title: "標題" },
  placement: "full",
  aspect: "16:9",
  width: 1920,
  height: 1080,
  fps: 30,
  frames: 90,
};

// The size, rate and length come with each overlay and card.
const metadata = ({ props }: { props: OverlayProps | CardProps }) => ({
  width: props.width,
  height: props.height,
  fps: props.fps,
  durationInFrames: props.frames,
});

registerRoot(() => (
  <>
    <Composition
      id={COMPOSITION}
      component={Overlay}
      defaultProps={defaults}
      calculateMetadata={metadata}
      width={defaults.width}
      height={defaults.height}
      fps={defaults.fps}
      durationInFrames={defaults.frames}
    />
    <Composition
      id={CARD_COMPOSITION}
      component={Card}
      defaultProps={cardDefaults}
      calculateMetadata={metadata}
      width={cardDefaults.width}
      height={cardDefaults.height}
      fps={cardDefaults.fps}
      durationInFrames={cardDefaults.frames}
    />
  </>
));
