// The music library's preview in the re-edit panel: the track asked for loads until its sound
// plays, which can take seconds while it downloads, or fails, and says so on its track.

/** The track previewed and how far it got; null when none is. */
export type Preview = { track: string; state: "loading" | "playing" | "failed" } | null;

export type PreviewEvent =
  /** A track's button: it plays, or stops if it is the one loading or playing. */
  | { type: "click"; track: string }
  /** The sound starts playing. */
  | { type: "playing" }
  /** The sound paused or ended. */
  | { type: "stopped" }
  /** The sound could not load or play: the track previewed's, or `track`'s when given. */
  | { type: "failed"; track?: string };

/** The preview after `event`. */
export function previewAfter(preview: Preview, event: PreviewEvent): Preview {
  switch (event.type) {
    case "click":
      return preview?.track === event.track && preview.state !== "failed"
        ? null
        : { track: event.track, state: "loading" };
    case "playing":
      return preview && { ...preview, state: "playing" };
    case "stopped":
      // Loading the next track pauses the one playing, which leaves the next loading.
      return preview?.state === "playing" ? null : preview;
    case "failed":
      return preview && (event.track ?? preview.track) === preview.track
        ? { ...preview, state: "failed" }
        : preview;
  }
}
