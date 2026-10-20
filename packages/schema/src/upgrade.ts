// A project written by an earlier version, as this one reads it. Fineframe 0.4.0 drew its motion
// graphics as `cards` and popped keywords with a `keyword` overlay; both are gone, so an older
// project keeps its cuts, framing, captions and the rest, and loses those. Planning it again gives
// it the motion graphics of this version.

type Json = Record<string, unknown>;
type Timed = { start: number; duration: number };

export interface Upgrade {
  /** The project with what this version no longer draws taken out. */
  project: unknown;
  /** How many of each were taken out; empty when the project was already current. */
  dropped: { cards: number; keywords: number };
}

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Takes out of a project what Fineframe 0.4.0 wrote and this version cannot draw:
 * - its `cards`, with the speaker clips in `broll` that played below a panel card and the sound
 *   effect that started with each card;
 * - its `keyword` overlays.
 * Anything else, or anything not shaped like a project, is passed on as it is for the schema to
 * check.
 */
export function upgradeProject(value: unknown): Upgrade {
  const dropped = { cards: 0, keywords: 0 };
  if (!isObject(value)) return { project: value, dropped };
  const project: Json = { ...value };
  const cards = Array.isArray(project.cards) ? (project.cards as Json[]) : null;
  if (cards) {
    delete project.cards;
    dropped.cards = cards.length;
    const timed = (card: Json): card is Json & Timed =>
      typeof card.start === "number" && typeof card.duration === "number";
    const panels = cards.filter((card) => card.placement === "panel").filter(timed);
    const speakers = new Set(
      (Array.isArray(project.main) ? (project.main as Json[]) : []).map((clip) => clip.source),
    );
    // A panel card split the screen with the speaker below it, as B-roll of the main track's own
    // source with a rect: without the card, that clip would show the speaker twice.
    if (Array.isArray(project.broll)) {
      project.broll = (project.broll as Json[]).filter(
        (clip) =>
          !(
            isObject(clip.rect) &&
            speakers.has(clip.source) &&
            typeof clip.start === "number" &&
            panels.some(
              (card) =>
                (clip.start as number) >= card.start &&
                (clip.start as number) < card.start + card.duration,
            )
          ),
      );
      if ((project.broll as Json[]).length === 0) delete project.broll;
    }
    const starts = new Set(cards.filter(timed).map((card) => card.start));
    if (isObject(project.audio) && Array.isArray(project.audio.sfx)) {
      const sfx = (project.audio.sfx as Json[]).filter(
        (effect) => !starts.has(effect.start as number),
      );
      const audio: Json = { ...project.audio, sfx };
      if (sfx.length === 0) delete audio.sfx;
      project.audio = audio;
    }
  }
  if (Array.isArray(project.overlays)) {
    const overlays = (project.overlays as Json[]).filter(
      (overlay) => overlay.template !== "keyword",
    );
    dropped.keywords = (project.overlays as Json[]).length - overlays.length;
    if (overlays.length > 0) project.overlays = overlays;
    else delete project.overlays;
  }
  return { project, dropped };
}
