// `pnpm edit`: footage in, a finished video out.
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { type ClaudeCost, type Progress, validateProgress } from "@video-editor/schema";
import {
  CAPTION_STYLES,
  type CaptionStyle,
  DEFAULT_CAPTIONS,
  isCaptionStyle,
} from "../captions/presets.ts";
import { isLookId, type LookId, lookIds } from "../looks.ts";
import { ClaudeError, QUALITIES, type Quality } from "../plan/claude.ts";
import { type Aspect, dollars, LENGTH_RANGE, PlanError } from "../plan/plan.ts";
import { VISUALS, type Visuals } from "../plan/visuals.ts";
import { edit, editShorts } from "./edit.ts";
import { EditError } from "./error.ts";
import { parseLength, parseSpan, SHORTS_COUNT, SHORTS_RANGE } from "./length.ts";

const [shortest, longest] = LENGTH_RANGE;
/** The longest --instructions: a few sentences, not a script. */
const INSTRUCTIONS_MAX = 2000;
const usage = `Usage: pnpm edit <footage folder or file>... --length <length> \\
    --aspect <9:16 | 1:1 | 16:9> -o <out.mp4> [--within <start>-<end>] [--short <about>] \\
    [--shorts <count>] [--names <names.txt>] [--terms <terms.txt>] \\
    [--correct] [--instructions <text>] [--asr <local | cloud>] \\
    [--look <${[...lookIds, "none"].join(" | ")}>] \\
    [--captions <${CAPTION_STYLES.join(" | ")}>] \\
    [--quality <best | economy>] [--visuals <rich | minimal>] \\
    [--music <track or folder>]... [--music-license <licence>]

Edits footage into a finished video within 5 % of the length asked. A folder stands for the
files directly in it: videos to cut, and still images to show as B-roll.

  -l, --length   ${shortest} s to ${longest / 3600} h: 60s, 90, 3m, 1m30s, 1:30, 1h. With --shorts, the range
                 each short's length lies in, within ${SHORTS_RANGE[0]} s to ${SHORTS_RANGE[1] / 60} min, two lengths joined by a
                 dash: 15-30s, 30-60s, 60-90s or 90s-3m
  -a, --aspect   9:16, 1:1 or 16:9
  -o, --output   the video; <name>.project.json, <name>.srt and edit_cuts.json go beside it. With
                 --shorts, a new folder: shorts.json and each short's folder go in it
      --within   cut only from this stretch of the one video given, such as 612-671 or
                 10:12-11:11, in seconds into it
      --short    plan the edit as one short of a longer video, about this ("<title>.
                 <description>" from shorts.json): hook first, with no opening title, as
                 --shorts makes each one; with --within, to plan a short again
      --shorts   make this many shorts, ${SHORTS_COUNT[0]} to ${SHORTS_COUNT[1]}, from one long video instead of one edit:
                 Claude finds the moments that stand alone, at most about one for each 2 min
                 of footage, and the best are made, fewer when the footage holds fewer. Each is
                 cut from one stretch of one file, at the length Claude picks within --length,
                 into 01/edit.mp4, 02/edit.mp4, … with their projects and captions beside them;
                 shorts.json lists each as it is done, with the title, description and
                 hashtags Claude wrote for it in the footage's language
      --names    a text file of people's names said in the footage, one per line, given to
                 the speech model and to --correct; a name there can show in a lower third
      --terms    a text file of other words said in the footage, such as brands and jargon,
                 one per line, given to the speech model and to --correct only
      --correct  have Claude correct each transcript before its words are timed
      --instructions
                 what you want of the edit, in your own words, such as "open with the demo"
                 or "leave out the pricing": Claude follows it as far as the footage and the
                 length allow, for a first edit and for one planned again; at most
                 ${INSTRUCTIONS_MAX} characters
      --asr      where the speech is heard: local (default, the most accurate) or cloud, on
                 OpenRouter with OPENROUTER_API_KEY, for machines without 9 GB of memory to
                 spare; cloud sends the speech audio, never video
      --look     the look over the edit: clean unless another is named, or none
      --captions the caption style: bold (word by word, the word said in amber) unless
                 another is named: creator (a few words at a time, big, in a box),
                 minimal (small white type), pop (each word pops in as it is said) or
                 none (no captions on the picture; the .srt is still written)
      --quality  best plans with Claude Opus; economy with Claude Sonnet, for about half
                 the cost. best unless given
      --visuals  rich (the default) adds motion graphics Claude writes for the video
                 and cuts to B-roll on the edit's points: captures of the web pages
                 named and, with PEXELS_API_KEY or PIXABAY_API_KEY (free), stock
                 footage, in full frame or a split screen, with a soft sound on a
                 visible action; their credits go to <name>.broll.txt beside the
                 video. minimal shows none
  -m, --music    background music Claude may choose from: an audio file, or a folder of them.
                 Use only music you have the right to use. Each track's licence is the first
                 line of <name>.txt beside it (a web address and a credit line may follow);
                 the licences are written to <name>.music.txt beside the video
      --music-license
                 the licence of every track without its own <name>.txt, such as "CC0 1.0"

Progress goes to stdout as JSON lines (packages/schema/progress.schema.json), and everything
for a person to stderr. Each file's analysis is kept in ~/.cache/video-editor/indexes, so
editing the same footage again starts at the plan. Claude plans the edit and checks its cuts:
ANTHROPIC_API_KEY, OPENROUTER_API_KEY for --asr cloud and the stock footage keys come from the
environment or the git-ignored .env at the repository root.`;

// A caller reading stdout, such as the web page, gets the reason as the last progress line.
const fail = (message: string): never => {
  const line: Progress = { stage: "error", fraction: 0, message };
  process.stdout.write(`${JSON.stringify(validateProgress(line))}\n`);
  console.error(`edit: error: ${message}\n\n${usage}`);
  process.exit(2);
};
const parsed = (() => {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        length: { type: "string", short: "l" },
        within: { type: "string" },
        short: { type: "string" },
        shorts: { type: "string" },
        aspect: { type: "string", short: "a" },
        output: { type: "string", short: "o" },
        names: { type: "string" },
        terms: { type: "string" },
        captions: { type: "string" },
        instructions: { type: "string" },
        correct: { type: "boolean" },
        asr: { type: "string" },
        look: { type: "string" },
        quality: { type: "string" },
        visuals: { type: "string" },
        music: { type: "string", short: "m", multiple: true },
        "music-license": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    return fail((error as Error).message);
  }
})();
const { values, positionals } = parsed;
if (values.help) {
  console.error(usage);
  process.exit(0);
}
if (positionals.length === 0 || !values.length || !values.aspect || !values.output) {
  fail("footage, --length, --aspect and -o are required");
}
const count = values.shorts === undefined ? null : Number(values.shorts);
if (count !== null && !Number.isInteger(count))
  fail(`--shorts takes a number, not ${values.shorts}`);
const range = count === null ? null : parseSpan(values.length as string);
if (count !== null && range === null) {
  fail(`with --shorts, --length is a range such as 30-60s, not ${values.length}`);
}
const length = count === null ? parseLength(values.length as string) : null;
if (count === null && length === null) fail(`${values.length} is not a length`);
const within = values.within === undefined ? null : parseSpan(values.within);
if (values.within !== undefined && within === null) {
  fail(`--within is a stretch such as 612-671 or 10:12-11:11, not ${values.within}`);
}
if ((within || values.short) && count !== null) {
  fail("--within and --short go without --shorts: each short has its own stretch");
}
const aspect = values.aspect as Aspect;
if (!["9:16", "1:1", "16:9"].includes(aspect))
  fail(`the aspect is 9:16, 1:1 or 16:9, not ${aspect}`);
const asr = values.asr ?? "local";
if (asr !== "local" && asr !== "cloud") fail(`--asr is local or cloud, not ${asr}`);
const look = values.look ?? "clean";
if (look !== "none" && !isLookId(look)) {
  fail(`the look is ${[...lookIds, "none"].join(", ")}, not ${look}`);
}

const captions = values.captions ?? DEFAULT_CAPTIONS;
if (!isCaptionStyle(captions)) {
  fail(`--captions is ${CAPTION_STYLES.join(", ")}, not ${captions}`);
}

const quality = values.quality ?? "best";
if (!QUALITIES.includes(quality as Quality)) {
  fail(`the quality is best or economy, not ${quality}`);
}

const instructions = values.instructions?.trim();
if (instructions !== undefined && instructions.length > INSTRUCTIONS_MAX) {
  fail(`--instructions takes at most ${INSTRUCTIONS_MAX} characters, not ${instructions.length}`);
}

const visuals = values.visuals ?? "rich";
if (!VISUALS.includes(visuals as Visuals)) fail(`--visuals is rich or minimal, not ${visuals}`);

const env = new URL("../../../../.env", import.meta.url);
if (existsSync(env)) process.loadEnvFile(env);
// pnpm runs scripts in the package's folder; the paths, and the files progress names, are the
// caller's. INIT_CWD is that folder only when pnpm ran this script: a program pnpm started, such
// as a server, passes it on to the commands it runs from folders of its own.
if (process.env.npm_lifecycle_event === "edit" && process.env.INIT_CWD) {
  process.chdir(process.env.INIT_CWD);
}

const say = (line: string) => process.stderr.write(`${line}\n`);
let cost: ClaudeCost | undefined;
const options = {
  inputs: positionals,
  aspect,
  out: values.output as string,
  ...(values.names ? { names: values.names } : {}),
  ...(values.terms ? { terms: values.terms } : {}),
  captions: captions as CaptionStyle,
  ...(instructions ? { instructions } : {}),
  correct: values.correct ?? false,
  asr: asr as "local" | "cloud",
  look: look as LookId | "none",
  quality: quality as Quality,
  visuals: visuals as Visuals,
  music: values.music ?? [],
  ...(values["music-license"] ? { musicLicense: values["music-license"] } : {}),
  onProgress: (line: Progress) => {
    process.stdout.write(`${JSON.stringify(line)}\n`);
    const file = "file" in line && line.file ? `${line.file}: ` : "";
    const short = "short" in line && line.short ? `short ${line.short.n}/${line.short.of} ` : "";
    say(`edit: ${line.stage} ${Math.round(line.fraction * 100)}% ${short}${file}${line.message}`);
    if (line.stage === "done") cost = line.claude;
  },
  onLog: say,
};
try {
  const result =
    count !== null && range
      ? await editShorts({ ...options, count, range })
      : await edit({
          ...options,
          length: length as number,
          ...(within ? { within: { start: within[0], end: within[1] } } : {}),
          ...(values.short?.trim() ? { short: values.short.trim() } : {}),
        });
  const { timings: t, usage: u } = result;
  const seconds = (value: number) => `${value.toFixed(1)} s`;
  say(
    `edit: analyze ${seconds(t.analyze)} (analysed ${result.analyzed}, from the cache ` +
      `${result.cached}), plan ${seconds(t.plan)}, render ${seconds(t.render)}, check ` +
      `${seconds(t.check)} (reviews: ${result.reviews}); Claude ${dollars(u.dollars)}: ` +
      `${cost?.find ? `find ${dollars(cost.find.dollars)}, ` : ""}plan ` +
      `${dollars(cost?.plan.dollars ?? null)}, graphics ${dollars(cost?.graphics?.dollars ?? 0)}, ` +
      `check ${dollars(cost?.check.dollars ?? null)} ` +
      `(requests: ${u.calls})`,
  );
} catch (error) {
  // A known error reached the caller as the last progress line and on stderr; anything else
  // is a bug, and its stack says where.
  const known = [EditError, PlanError, ClaudeError].some((kind) => error instanceof kind);
  if (!known) say(String((error as Error).stack));
  process.exit(1);
}
