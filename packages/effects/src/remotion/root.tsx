// Remotion's entry point, which its bundler builds into the page each overlay is rendered from.
// Code under remotion/ runs in the browser, so it imports only types from the Node side.

import { Composition, registerRoot } from "remotion";
import { Overlay } from "./Overlay.tsx";
import { COMPOSITION, type OverlayProps } from "./props.ts";

const defaults: OverlayProps = {
  template: "title",
  params: { text: "標題" },
  aspect: "16:9",
  width: 1920,
  height: 1080,
  fps: 30,
  frames: 90,
};

registerRoot(() => (
  <Composition
    id={COMPOSITION}
    component={Overlay}
    defaultProps={defaults}
    // The size, rate and length come with each overlay.
    calculateMetadata={({ props }) => ({
      width: props.width,
      height: props.height,
      fps: props.fps,
      durationInFrames: props.frames,
    })}
    width={defaults.width}
    height={defaults.height}
    fps={defaults.fps}
    durationInFrames={defaults.frames}
  />
));
