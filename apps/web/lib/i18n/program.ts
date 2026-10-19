// What the edit's programs write as they go, in the page's words: the engine's and vework's
// progress lines, the names of what they download, and the re-edit's labels for what is over the
// speaker. The programs write English; each pattern here reads one of their lines, and a line no
// pattern reads is shown as written. Names of files, models and people stay as they are.
import { en, type Messages } from "./en.ts";

type Words = Messages["progress"];
/** A line's groups; one a pattern leaves out, such as an optional one, is undefined. */
type Groups = [string, string, string, string, string];
const SAID: [RegExp, (words: Words, said: Groups, t: Messages) => string][] = [
  // vework's steps, as the engine passes them on with a capital (edit/analyze.ts).
  [/^Probing$/, (w) => w.probe],
  [/^Detecting shots$/, (w) => w.shots],
  [/^Finding speech$/, (w) => w.speech],
  [/^Measuring loudness$/, (w) => w.loudness],
  [/^Measuring loudness and sections$/, (w) => w.sections],
  [/^Finding audio events$/, (w) => w.events],
  [/^Finding faces$/, (w) => w.faces],
  [/^Removing noise from speech$/, (w) => w.denoise],
  [/^Transcribing (\d+\/\d+) \(US\$([\d.]+) so far\)$/, (w, [n, d]) => w.transcribeCost(n, d)],
  [/^Transcribing (\d+\/\d+)$/, (w, [n]) => w.transcribe(n)],
  [
    /^Transcribed on OpenRouter for US\$([\d.]+) \(US\$([\d.]+) per source minute\)$/,
    (w, [d, m]) => w.transcribed(d, m),
  ],
  [
    /^Correcting (\d+) chunks with (.+?)( in a Message Batch)?$/,
    (w, [n, model, batch]) => w.correct(n, model, batch !== undefined),
  ],
  [/^Correction batch (.+): (\d+\/\d+) done$/, (w, [b, n]) => w.correctBatch(b, n)],
  [/^Aligning (\d+\/\d+)$/, (w, [n]) => w.align(n)],
  [/^Decoding$/, (w) => w.decode],
  [/^Finding beats with beat_this (.+)$/, (w, [model]) => w.beats(model)],
  [
    /^Downloading (.+), the first time it is used$/,
    (w, [name], t) => w.downloadingFirst(downloadName(name, t)),
  ],
  [/^Downloading (.+)$/, (w, [name], t) => w.downloading(downloadName(name, t))],
  // The edit (edit/edit.ts).
  [/^Checking that Claude can plan the edit$/, (w) => w.checkClaude],
  [/^Reading the file$/, (w) => w.readFile],
  [/^Reading (\d+) files$/, (w, [n]) => w.readFiles(n)],
  [/^Analysed before$/, (w) => w.analysedBefore],
  // The plan (plan/plan.ts, plan/visuals.ts) and its review (plan/review.ts).
  [
    /^Planning (a short|a long) edit with (.+)$/,
    (w, [size, model]) => w.planning(size === "a short", model),
  ],
  [/^(.+) planned the edit \((.+)\)$/, (w, [model, d]) => w.planned(model, d)],
  [/^Sourced (\d+) of (\d+) visuals$/, (w, [n, of]) => w.sourced(n, of)],
  // The graphics (plan/graphics.ts).
  [/^(.+) wrote (\d+) graphics \((.+)\)$/, (w, [m, n, d]) => w.wroteGraphics(m, n, d)],
  [
    /^Left out the (\S+) graphic at ([\d.]+) s: ([\s\S]*)$/,
    (w, [layout, s, why], t) =>
      w.leftOutGraphic(layout, t.overlays.layouts[layout] ?? layout, s, why),
  ],
  [
    /^Left out a (\S+) graphic: ([\s\S]*)$/,
    (w, [layout, why], t) => w.leftOutCutGraphic(layout, t.overlays.layouts[layout] ?? layout, why),
  ],
  [
    /^Left out a graphic on words the edit does not say: "([\s\S]*)"$/,
    (w, [words]) => w.unsaidGraphic(words),
  ],
  [/^Kept (\d+) of (\d+) graphics$/, (w, [n, of]) => w.keptGraphics(n, of)],
  [
    /^Wrote no graphics for ([\d.]+)–([\d.]+) s: ([\s\S]*)$/,
    (w, [from, to, problem]) => w.noGraphics(from, to, problem),
  ],
  [
    /^Found (\d+) of (\d+) things to point at with (.+) \((.+)\)$/,
    (w, [n, of, model, cost]) => {
      const asked = cost.match(/^(\d+) requests, (.+)$/);
      const spent = asked ? w.requests(asked[1] as string, asked[2] as string) : cost;
      return w.located(n, of, model, cost === "all cached" ? w.cached : spent);
    },
  ],
  [/^The edit lasts ([\d.]+) s; asking for more material$/, (w, [s]) => w.tooShort(s)],
  [
    /^Left out the (\S+) visual on line (\d+): ([\s\S]*)$/,
    (w, [kind, line, reason]) => w.leftOutKind(kind, w.visuals[kind] ?? kind, line, reason),
  ],
  [/^The plan's visuals are not JSON; the edit has none$/, (w) => w.notJson],
  [/^The plan's visuals are not a list; the edit has none$/, (w) => w.notList],
  [
    /^Left out a visual the plan gave in another shape: ([\s\S]*)$/,
    (w, [json]) => w.otherShape(json),
  ],
  [
    /^Left out a visual on (.+) line (\d+): ([\s\S]*)$/,
    (w, [source, line, problem]) => w.leftOutOn(source, line, problem),
  ],
  [/^Measuring the colour of (\d+) clips$/, (w, [n]) => w.measuringColour(n)],
  [
    /^Left the colour of (.+?) as it is: ([\s\S]*)$/,
    (w, [source, problem]) => w.leftColour(source, problem),
  ],
  [
    /^Matched the colour of (.+) to (.+)$/,
    (w, [source, reference]) => w.matchedColour(source, reference),
  ],
  [
    /^Review (\d+): checking (\d+) cuts with (.+)$/,
    (w, [pass, cuts, model]) => w.reviewing(pass, cuts, model),
  ],
  [
    /^Review (\d+): (\d+) cuts checked, (\d+) judged by (.+) \((.+)\)$/,
    (w, [pass, cuts, judged, model, d]) => w.reviewed(pass, cuts, judged, model, d),
  ],
  [/^Review (\d+): fixing cuts and fitting again$/, (w, [pass]) => w.refitting(pass)],
  // The render (render.ts) and its effects (packages/effects/src/worker.ts).
  [/^Checking sources$/, (w) => w.checkingSources],
  [/^Mixing sound (\d+\/\d+)$/, (w, [n]) => w.mixingSound(n)],
  [/^Mixing music$/, (w) => w.mixingMusic],
  [/^Rendering (\d+\/\d+)$/, (w, [n]) => w.rendering(n)],
  [/^Finished$/, (w) => w.finished],
  [/^Rendering effect (\d+\/\d+)$/, (w, [n]) => w.renderingEffect(n)],
  [/^Rendered (\d+) effects$/, (w, [n]) => w.renderedEffects(n)],
  // The page's own server, before a render's first line (lib/jobs.ts).
  [/^Preparing the changes$/, (w) => w.preparingChanges],
  [/^Planning again$/, (w) => w.planningAgain],
  [/^Starting the render$/, (w) => w.startingRender],
];

/** A progress line of the edit's programs in `t`'s words, or as written when none says it. */
export function progressText(message: string, t: Messages): string {
  for (const [pattern, say] of SAID) {
    const said = message.match(pattern);
    if (said) return say(t.progress, said.slice(1) as Groups, t);
  }
  return message;
}

/** What each model vework downloads is for, by its name. */
const MODELS: [RegExp, keyof Messages["progress"]["models"]][] = [
  [/ASR/, "speech"],
  [/ForcedAligner/, "aligner"],
  [/ced-/, "events"],
  [/DeepFilterNet/, "denoise"],
  [/^Beat This!/, "beats"],
];

/** What is downloading, in `t`'s words: the page's own downloads by name, a model by what it is
 * for, anything else as its program names it. */
export function downloadName(name: string, t: Messages): string {
  const own = t.run.downloads[name];
  if (own) return own;
  const kind = MODELS.find(([pattern]) => pattern.test(name))?.[1];
  return kind ? t.progress.model(t.progress.models[kind], name) : name;
}

/** The engine's label for an overlay, graphic or B-roll clip (revise.ts) in `t`'s words: its
 * kind named, its text as it is. */
export function overlayLabel(label: string, t: Messages): string {
  const { overlays } = t;
  const graphic = label.match(/^Graphic \(([^)]+)\)(?:: ([\s\S]*))?$/);
  if (graphic) {
    const layout = graphic[1] as string;
    return overlays.graphic(overlays.layouts[layout] ?? layout, graphic[2]);
  }
  const broll = label.match(/^B-roll: ([\s\S]*)$/);
  if (broll) return overlays.broll(broll[1] as string);
  for (const [id, name] of Object.entries(en.overlays.templates)) {
    const own = overlays.templates[id] ?? name;
    if (label === name) return own;
    if (label.startsWith(`${name}: `)) return overlays.labelled(own, label.slice(name.length + 2));
  }
  return label;
}
