// The page's words in English, the language every other one matches key for key. A function
// takes what a sentence counts or names; the page's own formatting (lengths, prices, rounding)
// stays in lib and puts these words around it.
import type { CaptionStyle } from "@video-editor/engine/captions";
import { LOOKS, type LookId, lookIds } from "@video-editor/engine/looks";

/** Where a graphic draws, as the engine names its layouts (packages/effects/src/graphics.ts),
 * which the page cannot import: its renderer is Node's. */
export const GRAPHIC_LAYOUTS = ["label", "lower-third", "panel", "full"] as const;

/** What the desktop app's first start downloads, as lib/setup.ts names it. */
export const SETUP_DOWNLOAD = "the analysis environment (Python, PyTorch and the worker)";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A date and time as the system writes them, unless the system writes Chinese. */
function date(milliseconds: number): string {
  const system = Intl.DateTimeFormat().resolvedOptions().locale;
  return new Date(milliseconds).toLocaleString(/^zh\b/i.test(system) ? "en-US" : undefined);
}

export const en = {
  date,
  units: { h: "h", min: "min", s: "s" },
  /** A list of parts, as in "1 video, 2 photos". */
  list: ", ",
  dollars: { unknown: "unknown", under: "under $0.01" },
  meta: {
    description: "Drop in footage, choose a length and an aspect, and get back a finished video.",
  },
  header: {
    language: "Language",
    keySaved: "API key saved · Replace",
    addKey: "Add your API key",
  },
  compose: {
    title: "Drop in footage. Get back a finished video.",
    lede: "Cut to the length you choose, with the best takes kept, fillers and dead air removed, and captions to go with it.",
    settings: "Settings",
    installing: "Setting up the analysis first",
    setupFailed: "The analysis could not be set up",
    addFootage: "Add footage to start",
    addVideo: "Add at least one video: the edit is cut from video",
    musicLicense: "Say under which licence you use the music",
    refused: "The server refused the edit",
    notStarted: "The edit did not start",
    openFailed: "The project could not be opened",
    startFallback: "The edit could not be started.",
    sending: (file: number, files: number) => `Sending footage · file ${file} of ${files}`,
    of: (done: string, total: string) => `${done} of ${total}`,
    cancel: "Cancel",
    make: (length: string) => `Make the ${length} video`,
    makeVideo: "Make the video",
    makeShorts: (count: number) => `Make ${plural(count, "short", "shorts")}`,
    needAnthropic: "Add your Anthropic API key to start",
    needOpenRouter: "Add your OpenRouter API key to start",
    estimate: (low: string, high: string) =>
      `Claude will cost about ${low} to ${high} for this edit`,
    estimateShorts: (low: string, high: string) =>
      `Claude will cost about ${low} to ${high} to find the moments and make each short`,
    privacyCloud:
      "Footage stays on this computer. OpenRouter hears the speech audio; Claude reads the transcripts and stills around each cut. No video file is uploaded.",
    privacyLocal:
      "Footage stays on the server that runs this page. Claude reads the transcripts and stills around each cut; no video or audio file is uploaded.",
    notSent: (name: string) => `${name} could not be sent`,
    notSentStatus: (name: string, status: number) => `${name} could not be sent (HTTP ${status})`,
  },
  setup: {
    title: "Setting up the analysis",
    failed: "The analysis could not be set up",
    about:
      "Only the first time: Python and the packages that analyse footage download and install on this computer. Add your keys and footage meanwhile.",
    fallback: "The download or the install stopped.",
    retry: "Try again",
    starting: "Starting…",
  },
  footage: {
    dropHere: "Drop footage here",
    dropMore: "Drop more footage",
    drop: "Drop video files or a whole folder",
    hint: "Videos are cut into the edit; photos can appear over it as B-roll, and audio files are music for it.",
    chooseFiles: "Choose files",
    chooseFolder: "Choose a folder",
    title: "Footage",
    videos: (n: number) => plural(n, "video", "videos"),
    photos: (n: number) => plural(n, "photo", "photos"),
    tracks: (n: number) => plural(n, "music track", "music tracks"),
    inAll: (clock: string) => `${clock} in all`,
    leftOut: (n: number) => `${plural(n, "other file", "other files")} left out`,
    clear: "Clear all",
    notUsed: "Not used",
    music: "Music",
    photo: "Photo",
    lengthUnknown: "Length unknown",
    asMusic: "Use as music",
    notMusic: "Don't use",
    asMusicLabel: (path: string) => `Use ${path} as music`,
    notMusicLabel: (path: string) => `Don't use ${path} as music`,
    remove: (path: string) => `Remove ${path}`,
  },
  settings: {
    what: "What to make",
    whatChoices: { one: "One video", shorts: "Several shorts" },
    shortLength: "Length of each short",
    shortLengthHelp: "Claude picks each short's length within the range, to fit its moment.",
    count: "How many shorts",
    countHelp:
      "Claude finds the moments worth posting, at most about one for each 2 minutes of footage, and makes the best ones, each from one stretch of the video.",
    length: "Length",
    range: (shortest: string, longest: string) => `${shortest} to ${longest}`,
    custom: "Custom",
    customLabel: "Custom length",
    customPlaceholder: "90 s, 2:30, 1 h",
    typeLength: "Type a length",
    lengthExample: "Type a length such as 90 s, 2:30 or 1 h",
    shortest: (length: string) => `The shortest edit is ${length}`,
    longest: (length: string) => `The longest edit is ${length}`,
    tooLong: (length: string) =>
      `Longer than all of the footage (${length}); the edit can only keep what was said.`,
    aspect: "Aspect",
    aspects: {
      "9:16": { name: "Vertical", hint: "9:16 · phones" },
      "1:1": { name: "Square", hint: "1:1 · feeds" },
      "16:9": { name: "Wide", hint: "16:9 · screens" },
    },
    optional: "Optional",
    instructions: "Tell Claude what you want",
    instructionsPlaceholder: "Focus on the product demo\nLeave out the small talk at the start",
    instructionsHelp: (max: number) =>
      `What to keep, leave out or open with, in up to ${max} characters. Only for this edit: the next one starts empty.`,
    instructionsTooLong: (max: number, length: number) =>
      `Tell Claude what you want in at most ${max} characters, not ${length}`,
    style: "Style",
    names: "People's names",
    namesHelp:
      "One per line, spelled as the captions should show them. Helps the speech model hear them, and a lower third can show them.",
    terms: "Terms",
    termsHelp:
      "Brands, products and jargon, one per line. Only helps the speech model hear them; never shown as a name. Both lists are kept for your next edit.",
    speech: "Speech",
    local: "On this computer",
    lowMemory: (gigabytes: number) =>
      `This computer has ${gigabytes} GB of memory, and the speech model needs about 9 GB of it, so speech is heard on OpenRouter.`,
    localHelp:
      "The most accurate, and nothing is sent; it needs about 9 GB of memory and downloads 3.4 GB the first time.",
    cloudHelp:
      "Qwen3-ASR hears the speech on OpenRouter with your OpenRouter key, for about US$0.03 an hour of footage. Only the speech audio is sent; the words are timed on this computer.",
    addOpenRouter: "Add your OpenRouter key",
    visuals: "Visuals",
    visualsChoices: {
      rich: {
        name: "Rich",
        help: "Claude adds visuals to the points the speaker makes: motion graphics written for this video, the web pages they name and stock footage, beside the speaker or full frame, with soft sound effects.",
      },
      minimal: { name: "Minimal", help: "Only the footage you dropped in, cut and captioned." },
    },
    stock: "Stock footage needs a free Pexels or Pixabay key; optional.",
    stockKey: (name: string, saved: boolean) =>
      saved ? `${name} key saved · Replace` : `${name} key`,
    advanced: "Advanced settings",
    quality: "Quality",
    qualities: {
      best: { name: "Best", help: "Claude Opus plans the edit and judges the doubtful cuts." },
      economy: {
        name: "Economy",
        help: "Claude Sonnet plans the edit and judges the doubtful cuts, for about half the cost.",
      },
    },
    correction: "Transcript correction",
    on: "On",
    off: "Off",
    correctionHelp:
      "Claude reads each transcript with your names and terms and fixes what the speech model misheard, before its words are timed. Adds a Claude cost.",
    captionStyle: "Caption style",
    /** The four words a caption preview says, a number among them, and what goes between them. */
    sample: ["Edit", "in", "10", "minutes"],
    sampleGap: " ",
    license: "Music licence",
    licenseHelp:
      "Use only music you have the right to use; this licence covers every track. Claude picks the track that fits, or none, and sets it under the voice.",
  },
  /** The looks, by the engine's ids, and the footage's own colour. */
  looks: {
    ...(Object.fromEntries(
      lookIds.map((id) => [
        id,
        { name: `${id[0]?.toUpperCase()}${id.slice(1)}`, description: LOOKS[id].description },
      ]),
    ) as Record<LookId, { name: string; description: string }>),
    none: {
      name: "None",
      description: "No look: the footage's own colour, balanced and matched between cameras.",
    },
  },
  /** The caption styles, by the engine's ids. */
  captions: {
    bold: {
      name: "Highlight",
      description: "Heavy white type, highlighted word by word: the word being said turns amber.",
    },
    creator: {
      name: "Bold",
      description: "A few words at a time, big, in a dark box; numbers and English words in amber.",
    },
    minimal: { name: "Minimal", description: "Small white type, no highlight." },
    pop: { name: "Pop", description: "Each word pops in as it is said." },
    none: {
      name: "None",
      description: "No captions on the video; the subtitle file (.srt) is still made.",
    },
  } as Record<CaptionStyle, { name: string; description: string }>,
  keys: {
    anthropic: {
      title: "Connect Claude",
      about:
        "Claude plans each edit and checks its cuts with your Anthropic API key, billed to your Anthropic account. Create one at",
      placeholder: "sk-ant-…",
      /** What follows the site's link. */
      end: ".",
    },
    openrouter: {
      title: "Connect OpenRouter",
      about:
        "OpenRouter hears the speech with your OpenRouter API key, billed to your OpenRouter account at about US$0.03 an hour of footage. Create one at",
      placeholder: "sk-or-…",
      /** What follows the site's link. */
      end: ".",
    },
    pexels: {
      title: "Connect Pexels",
      about:
        "Optional: with your free Pexels API key, Claude can show stock footage from Pexels in the edit. Without it, the edit shows motion graphics and web pages instead. Get one at",
      placeholder: "Pexels API key",
      /** What follows the site's link. */
      end: ".",
    },
    pixabay: {
      title: "Connect Pixabay",
      about:
        "Optional: with your free Pixabay API key, Claude can show stock footage from Pixabay in the edit. Without it, the edit shows motion graphics and web pages instead. Get one at",
      placeholder: "Pixabay API key",
      /** What follows the site's link. */
      end: ".",
    },
    replace: (name: string) => `Replace your ${name} API key`,
    key: "API key",
    notSaved: "The key could not be saved",
    fallback: "The key could not be checked.",
    cancel: "Cancel",
    later: "Later",
    checking: (name: string) => `Checking with ${name}…`,
    save: "Check and save",
    stored: (name: string) =>
      `Saved on this computer in a file only your user can read. It is sent to ${name} and nowhere else, and this page never shows it again.`,
  },
  run: {
    progress: "Progress",
    running: "Making your edit",
    runningShorts: "Making your shorts",
    short: (n: number, of: number) => `Short ${n} of ${of}`,
    stopped: "Stopped",
    from: (length: string, aspect: string, videos: number, photos: number) =>
      `${length} · ${aspect} · from ${plural(videos, "video", "videos")}${photos > 0 ? ` and ${plural(photos, "photo", "photos")}` : ""}`,
    shortsFrom: (count: number, range: string, aspect: string) =>
      `${plural(count, "short", "shorts")} of ${range} · ${aspect}`,
    elapsed: (clock: string) => `${clock} elapsed`,
    estimated: "Estimated from how fast the edit has gone so far",
    approximate: (left: string) => `${left} (approximate)`,
    starting: "Starting: ",
    doing: (stage: string) => `${stage}: `,
    gettingReady: "getting ready",
    stages: {
      analyze: {
        name: "Analyse",
        doing: "Analysing",
        what: "Shots, speech and words in each file",
      },
      plan: { name: "Plan", doing: "Planning", what: "The best takes, cut to the length" },
      render: { name: "Render", doing: "Rendering", what: "Cuts, framing, colour and sound" },
      check: { name: "Check", doing: "Checking", what: "Every cut reviewed and fixed" },
    },
    steps: {
      probe: "Reading the file",
      shots: "Shots",
      speech: "Voice activity",
      loudness: "Loudness",
      events: "Audio events",
      faces: "Faces and speakers",
      denoise: "Speech clean-up",
      transcribe: "Transcript",
      correct: "Transcript correction",
      align: "Word timing",
    },
    analyse: "Analyse",
    musicFile: "Music: ",
    states: { active: ", running", done: ", done", failed: ", failed", pending: ", pending" },
    downloading: (name: string) => `Downloading ${name}`,
    /** What downloads that the page names itself; any other name is the program's. */
    downloads: {
      [SETUP_DOWNLOAD]: SETUP_DOWNLOAD,
      ffprobe: "ffprobe",
    } as Record<string, string>,
    left: (time: string) => ` · about ${time} left`,
    firstTime: " · only the first time it is used",
    cancel: "Cancel",
    sure: "Stop the edit? Click again",
    closeable:
      "You can close this page: the edit keeps going, and the page shows it again when you come back.",
  },
  eta: {
    underMinute: "Less than a minute left",
    about: (time: string) => `About ${time} left`,
  },
  done: {
    label: "The edit",
    player: "Your edit",
    ready: "Your edit is ready",
    captions: " · captions",
    download: "Download MP4",
    downloadCaptions: "Download captions (SRT)",
    downloadCredits: "Download B-roll credits (TXT)",
    another: "Make another edit",
  },
  shorts: {
    label: "The shorts",
    title: (made: number) => `${plural(made, "short", "shorts")}`,
    making: (made: number, of: number) => `${made} of ${of} made so far`,
    waiting: "Being made",
    card: (n: number, title: string) => `Short ${n}: ${title}`,
    stretch: (from: string, to: string) => `${from}–${to} in the source`,
    open: "Open",
    download: "Download",
    downloadAll: "Download all (ZIP)",
    allHelp:
      "Each short's MP4 and SRT, and a text file of their titles, descriptions and hashtags.",
    fewer: (made: number, asked: number, range: string) =>
      `Only ${plural(made, "moment", "moments")} in this footage could be made into a short of ${range}, so ${made} ${made === 1 ? "was" : "were"} made instead of ${asked}.`,
    back: "All shorts",
    titleLabel: "Title",
    description: "Description",
    hashtags: "Hashtags",
    copy: "Copy",
    copied: "Copied",
  },
  failed: {
    cancelled: "The edit was cancelled",
    title: "The edit could not be finished",
    wrong: "Something went wrong",
    fallback: "The edit stopped before it finished.",
    spent: (dollars: string) => `Claude cost ${dollars} before the edit stopped.`,
    replaceKey: "Replace the API key",
    replaceOpenRouter: "Replace the OpenRouter key",
    addCredit: "Add credit",
    retry: "Try again",
    changeFootage: "Change the footage",
    back: "Back to the footage",
  },
  summary: {
    length: "Length",
    target: (length: string) => `Target ${length}`,
    actual: (clock: string) => ` · Actual ${clock}`,
    each: (range: string) => `${range} each`,
    aspect: "Aspect",
    style: "Style",
    captions: "Captions",
    speech: "Speech",
    local: "On this computer",
    visuals: "Visuals",
    footage: "Footage",
    music: "Music",
    noMusic: "None chosen",
    offered: (n: number) => `${plural(n, "track", "tracks")} offered`,
    names: "Names",
    namesAndTerms: "Names and terms",
    terms: "Terms",
    planned: "Planned",
    withInstructions: "With instructions",
    finding: "Claude, finding the moments",
    planning: "Claude, planning",
    graphics: "Claude, motion graphics",
    checking: "Claude, checking cuts",
    claude: "Claude",
    noPlan: "None: changed without a new plan",
    total: "Claude, all versions in total",
  },
  projects: {
    title: "Projects",
    status: {
      uploading: "Not started",
      running: "Running",
      done: "Done",
      error: "Failed",
      cancelled: "Cancelled",
    },
    meta: (projects: number, size: string, kept: number) =>
      `${plural(projects, "project", "projects")} · ${size} on disk · the newest ${kept} finished keep their footage for editing again`,
    notDeleted: "The project could not be deleted",
    fallback: "The project could not be deleted.",
    untitled: "Untitled",
    footageRemoved: " · footage removed",
    shorts: (n: number) => plural(n, "short", "shorts"),
    open: "Open",
    sure: "Delete? Click again",
    delete: "Delete",
  },
  reedit: {
    label: "Change the edit",
    loadFallback: "This edit's changes could not be loaded.",
    loading: "Loading…",
    noFootage:
      "This project's footage was deleted, so it cannot change; make a new edit from the footage",
    noChange: "Make a change first",
    notApplied: "The changes could not be applied",
    title: "Change the edit",
    version: (n: number, clock: string) => `Version ${n} · ${clock}`,
    afterCuts: (clock: string) => ` · ${clock} after the cuts`,
    transcript: "Transcript",
    help: "Click a word, then Shift-click another to select the words between. Delete them, or fix a single caption word. Each cut moves to a pause inside your selection, so no word is cut through; ✂ marks where it lands, and selected words a dotted line marks stay.",
    keys: {
      play: "play or pause",
      move: "move between words, with",
      select: "to select",
      cut: "cut the selected words",
      undo: "undo the last change",
      frame: "one frame, in the player",
    },
    noCaptions: "This edit has no captions to show.",
    lands: (seconds: string) => `Cut lands at ${seconds} s`,
    keptWord: "Kept: no pause to cut at beside it inside the selection",
    span: (from: string, to: string) => `${from}–${to} s`,
    states: {
      cut: "to cut",
      kept: "kept: no pause to cut at",
      gone: "cut",
      fixed: "fixed",
    } as Record<string, string>,
    selected: (n: number, span: string) => `${plural(n, "word", "words")} selected, ${span}`,
    delete: "Delete",
    clear: "Clear",
    cutWords: (words: string) => `Cut “${words}”`,
    landsSpan: (span: string) => ` · lands ${span}`,
    outside: (words: string) =>
      `No pause inside your selection, so this cut also removes: ${words}`,
    undo: "Undo",
    titles: "Title and lower thirds",
    lowerThird: "Lower third · ",
    params: { text: "Title", subtitle: "Subtitle", name: "Name", role: "Role" } as Record<
      string,
      string
    >,
    music: "Music",
    volume: "Volume",
    removeMusic: "Remove the music",
    noMusic: "This edit has no music.",
    look: "Look",
    captionStyle: "Caption style",
    overlays: "Overlays",
    keep: "Keep",
    remove: "Remove",
    replanTitle: "Needs a re-plan",
    replanHelp:
      "Reordering, putting removed parts back, a length more than 5 % off, another aspect or another music track cannot be changed here: Claude plans the edit again from the same footage, whose analysis is kept, so it takes a minute or two and one more plan.",
    replan: "Re-plan…",
    older:
      "This edit was made with an earlier version: its motion-graphics cards and keyword pops are left out when it renders again. Re-plan it for the new motion graphics.",
    fallback: "The changes could not be made.",
    renderFallback: "The new version could not be rendered.",
    rendering: (n: number, message: string) => `Rendering version ${n} · ${message}`,
    keepsPlaying: (n: number) => `Version ${n} keeps playing until the new one is ready.`,
    stop: "Stop",
    apply: "Apply",
    applyCount: (n: number) => `Apply ${plural(n, "change", "changes")}`,
    renders: (described: string, n: number) => `${described}. Renders once as version ${n}.`,
    word: "Caption word",
    fix: "Fix word",
    /** The changes in a few words, for the version list. */
    describe: {
      cuts: (n: number) => `cut ${plural(n, "span", "spans")}`,
      words: (n: number) => `fixed ${plural(n, "caption word", "caption words")}`,
      titles: "changed the titles",
      removed: (n: number) => `removed ${plural(n, "overlay", "overlays")}`,
      noMusic: "removed the music",
      music: (gain: string) => `music ${gain} dB`,
      look: (id: string, _name: string) => `look ${id}`,
      captions: (id: string, _name: string) => `captions ${id}`,
      none: "No changes",
    },
  },
  replan: {
    notPlanned: "The edit could not be planned again",
    help: "Claude decides the story order and what to keep again, so it may reorder, put back or leave out other parts than this version. It becomes a new version; this one stays in the list.",
    length: "Length",
    aspect: "Aspect",
    music: "Music",
    auto: "Let Claude choose again",
    none: "No music",
    instructions: "Tell Claude what to change",
    optional: "Optional",
    placeholder: "Open with the demo\nPut back the part about pricing\nEnd on the question",
    fallback: "The edit could not be planned again.",
    start: "Re-plan as a new version",
    stretch: (margin: number) =>
      `A short is planned again from its own stretch of the video and up to ${margin} s on each side.`,
    cancel: "Cancel",
  },
  versions: {
    title: "Versions",
    notShown: "That version could not be shown",
    fallback: "That version could not be shown.",
    version: (n: number) => `Version ${n}`,
    shown: " · shown",
    first: (instructions: boolean): string =>
      instructions ? "The edit, with instructions" : "The edit",
    rendering: " · rendering",
    notKept: " · video not kept",
    show: "Show",
    again: "Render again",
    kept: "The newest 3 versions keep their video; an older one renders again from its record.",
    changes: "Changes",
    replanned: (length: string, aspect: string) => `Planned again: ${length}, ${aspect}`,
    noMusic: "no music",
    withInstructions: "with instructions",
  },
  /** What the edit's programs say as they go (lib/i18n/program.ts reads each), in English as
   * they write it. */
  progress: {
    probe: "Probing",
    shots: "Detecting shots",
    shotsDone: (percent: string) => `Detecting shots ${percent}%`,
    speech: "Finding speech",
    loudness: "Measuring loudness",
    sections: "Measuring loudness and sections",
    events: "Finding audio events",
    faces: "Finding faces",
    denoise: "Removing noise from speech",
    transcribe: (count: string) => `Transcribing ${count}`,
    transcribeCost: (count: string, dollars: string) =>
      `Transcribing ${count} (US$${dollars} so far)`,
    transcribed: (dollars: string, perMinute: string) =>
      `Transcribed on OpenRouter for US$${dollars} (US$${perMinute} per source minute)`,
    correct: (chunks: string, model: string, batch: boolean) =>
      `Correcting ${chunks} chunks with ${model}${batch ? " in a Message Batch" : ""}`,
    correctBatch: (batch: string, count: string) => `Correction batch ${batch}: ${count} done`,
    align: (count: string) => `Aligning ${count}`,
    decode: "Decoding",
    beats: (model: string) => `Finding beats with beat_this ${model}`,
    downloading: (name: string) => `Downloading ${name}`,
    downloadingFirst: (name: string) => `Downloading ${name}, the first time it is used`,
    /** A model downloading, by what it is for: English names it alone. */
    model: (_kind: string, name: string) => name,
    models: {
      speech: "speech model",
      aligner: "word timing model",
      events: "audio events model",
      denoise: "speech clean-up model",
      beats: "beat model",
    },
    checkClaude: "Checking that Claude can plan the edit",
    finding: "Finding the moments that stand alone as shorts",
    found: (count: string) => `Found ${count} moments`,
    readFile: "Reading the file",
    readFiles: (files: string) => `Reading ${files} files`,
    analysedBefore: "Analysed before",
    planning: (short: boolean, model: string) =>
      `Planning ${short ? "a short" : "a long"} edit with ${model}`,
    planned: (model: string, dollars: string) => `${model} planned the edit (${dollars})`,
    wroteGraphics: (model: string, count: string, dollars: string) =>
      `${model} wrote ${count} graphics (${dollars})`,
    leftOutGraphic: (layout: string, _name: string, seconds: string, reason: string) =>
      `Left out the ${layout} graphic at ${seconds} s: ${reason}`,
    leftOutCutGraphic: (layout: string, _name: string, reason: string) =>
      `Left out a ${layout} graphic: ${reason}`,
    unsaidGraphic: (words: string) =>
      `Left out a graphic on words the edit does not say: "${words}"`,
    keptGraphics: (kept: string, written: string) => `Kept ${kept} of ${written} graphics`,
    noGraphics: (from: string, to: string, problem: string) =>
      `Wrote no graphics for ${from}–${to} s: ${problem}`,
    sourced: (ready: string, visuals: string) => `Sourced ${ready} of ${visuals} visuals`,
    located: (found: string, wishes: string, model: string, cost: string) =>
      `Found ${found} of ${wishes} things to point at with ${model} (${cost})`,
    requests: (requests: string, dollars: string) => `${requests} requests, ${dollars}`,
    cached: "all cached",
    tooShort: (seconds: string) => `The edit lasts ${seconds} s; asking for more material`,
    leftOutKind: (kind: string, _name: string, line: string, reason: string) =>
      `Left out the ${kind} visual on line ${line}: ${reason}`,
    /** The kinds of visual the plan asks for. */
    visuals: { stock: "stock", web: "web" } as Record<string, string>,
    notJson: "The plan's visuals are not JSON; the edit has none",
    notList: "The plan's visuals are not a list; the edit has none",
    otherShape: (json: string) => `Left out a visual the plan gave in another shape: ${json}`,
    leftOutOn: (source: string, line: string, problem: string) =>
      `Left out a visual on ${source} line ${line}: ${problem}`,
    measuringColour: (clips: string) => `Measuring the colour of ${clips} clips`,
    leftColour: (source: string, problem: string) =>
      `Left the colour of ${source} as it is: ${problem}`,
    matchedColour: (source: string, reference: string) =>
      `Matched the colour of ${source} to ${reference}`,
    reviewing: (pass: string, cuts: string, model: string) =>
      `Review ${pass}: checking ${cuts} cuts with ${model}`,
    reviewed: (pass: string, cuts: string, judged: string, model: string, dollars: string) =>
      `Review ${pass}: ${cuts} cuts checked, ${judged} judged by ${model} (${dollars})`,
    refitting: (pass: string) => `Review ${pass}: fixing cuts and fitting again`,
    checkingSources: "Checking sources",
    mixingSound: (count: string) => `Mixing sound ${count}`,
    mixingMusic: "Mixing music",
    rendering: (count: string) => `Rendering ${count}`,
    finished: "Finished",
    renderingEffect: (count: string) => `Rendering effect ${count}`,
    renderedEffects: (count: string) => `Rendered ${count} effects`,
    preparingChanges: "Preparing the changes",
    planningAgain: "Planning again",
    startingRender: "Starting the render",
  },
  /** What the re-edit lists over the speaker, as the engine labels each (revise.ts). */
  overlays: {
    templates: {
      title: "Title",
      "lower-third": "Lower third",
      chapter: "Chapter",
      callout: "Callout",
      wipe: "Wipe",
    } as Record<string, string>,
    /** Where a graphic draws, which English names by the engine's own words. */
    layouts: Object.fromEntries(GRAPHIC_LAYOUTS.map((id) => [id, id])) as Record<string, string>,
    labelled: (name: string, text: string) => `${name}: ${text}`,
    graphic: (layout: string, text?: string) =>
      `Graphic (${layout})${text === undefined ? "" : `: ${text}`}`,
    broll: (name: string) => `B-roll: ${name}`,
  },
  errors: {
    show: "Show details",
    hide: "Hide details",
    fixes: {
      key: {
        summary: "Anthropic did not accept the API key.",
        next: "Replace it, then start the edit again.",
      },
      openrouter: {
        summary: "OpenRouter did not accept the key, or has no credit left for it.",
        next: "Replace the key or add credit at openrouter.ai/settings/credits, then start the edit again.",
      },
      credit: {
        summary: "The Anthropic account is out of credit.",
        next: "Add some at console.anthropic.com/settings/billing, then start the edit again: the analysis is kept.",
      },
      disk: {
        summary: "The disk is full.",
        next: "Free some space, then start the edit again. Speech recognition needs about 3.5 GB the first time, and each edit's files take a few times the size of its footage; deleting older projects frees theirs.",
      },
      file: {
        summary: "One of the files can't be read.",
        next: "It may be damaged, still copying, or in a format Fineframe can't read. Leave it out, or convert it to MP4, and start again.",
      },
      missing: {
        summary: "A file this edit needs can't be found.",
        next: "Check that it is still where it was and that its drive is connected, then try again.",
      },
      network: {
        summary: "Fineframe could not reach the internet.",
        next: "Check the connection and start the edit again: what was analysed or downloaded is kept.",
      },
      length: {
        summary: "The footage is shorter than the edit.",
        next: "Choose a shorter length, or add footage, and start again.",
      },
    },
  },
  /** What the server says to the page when it refuses a request. */
  server: {
    wrong: "Something went wrong on the server",
    otherSite: "Requests from another site are refused",
    badName: (path: string) => `${path}: not a file name the page can keep`,
    twice: (path: string) => `${path}: given twice`,
    notMedia: (path: string) =>
      `${path}: not a video, a still image or music. Leave it out, or convert it to MP4`,
    empty: (path: string) => `${path}: empty`,
    noVideo: "An edit is cut from video: add at least one video file",
    musicLicense: "Say under which licence you use the music, such as CC0 1.0",
    disk: (needed: string, free: string) =>
      `Not enough free disk space for this footage: it needs about ${needed} and ${free} is free. Free some space, or leave some files out`,
    noEdit: "No such edit",
    underWay: "This edit is under way; cancel it before deleting it",
    noMoreFiles: "This edit takes no more files",
    noFile: "No such file in this edit",
    larger: (path: string) => `${path}: larger than said`,
    incomplete: (path: string) => `${path}: arrived incomplete; drop it again`,
    started: "This edit has already started",
    notArrived: (path: string) => `${path} has not arrived yet`,
    needAnthropic: "Add your Anthropic API key first: Claude plans the edit",
    needOpenRouter:
      "Add your OpenRouter API key first: it hears the speech, or choose this computer",
    busy: "Another edit is running; wait for it to finish or cancel it",
    rendering: "A version is rendering; wait for it to finish or stop it",
    noVersion: "No such version",
    notOffered: "That music track is not one this edit was offered",
    notFinished: "Only a finished edit can change",
    footageDeleted: (kept: number) =>
      `This project's footage was deleted, as only the newest ${kept} keep theirs; make a new edit from the footage instead`,
    noChanges: "No changes to apply",
    noCredits: "This edit has no B-roll credits",
    noCaptions: "This edit has no captions",
    noShort: "No such short",
    tooLarge: "The shorts are too large for one zip; download them one by one",
    emptyFile: "The file is empty",
    noFootage: "Drop some footage first",
    setupFailed: (error: string) => `The analysis could not be set up: ${error}`,
    settingUp: "The analysis is still being set up; the page shows how far it is",
    notReady: "The video is not ready",
    noService: "No such service",
    pasteKey: "Paste the whole key: one line of letters and digits",
    pastePrefixed: (prefix: string) => `Paste the whole key: one line, starting with ${prefix}`,
    rejected: (name: string, site: string) =>
      `${name} did not accept this key. Copy it again from ${site}`,
    noModel: (model: string) =>
      `This key cannot use ${model}, which plans the edit. Use a key from an account that has it`,
    unreachable: (name: string) =>
      `Could not reach ${name} to check the key. Check the internet connection and try again`,
    uncheckable: (name: string, status: number) =>
      `${name} could not check the key (HTTP ${status}). Try again`,
    anthropicSaid: (message: string) => `Anthropic could not check the key: ${message}`,
  },
};

export type Messages = typeof en;
