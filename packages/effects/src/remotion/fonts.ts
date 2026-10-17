// Fonts come in slices by Unicode range; a frame waits until every slice its text needs has
// loaded, so no frame is captured in a fallback font.

import { useEffect, useState } from "react";
import { cancelRender, continueRender, delayRender } from "remotion";

/** Holds the render until each of `faces`, a CSS font shorthand like `700 16px "Noto Sans TC"`,
 * has loaded the slices that `text` needs. */
export function useFonts(faces: string[], text: string): void {
  const [handle] = useState(() => delayRender("Loading fonts"));
  useEffect(() => {
    Promise.all(faces.map((face) => document.fonts.load(face, text)))
      .then(() => continueRender(handle))
      .catch(cancelRender);
  }, [handle, faces, text]);
}
