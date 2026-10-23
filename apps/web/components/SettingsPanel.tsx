"use client";

import type { CaptionStyle } from "@video-editor/engine/captions";
import { ChevronRight } from "lucide-react";
import { useId } from "react";
import { en, type Messages } from "../lib/i18n/messages.ts";
import {
  ASPECTS,
  type Aspect,
  type Asr,
  CAPTION_STYLES,
  DEFAULT_CAPTIONS,
  FILLER_MODES,
  type FillerMode,
  formatLength,
  formatRange,
  INSTRUCTIONS_MAX,
  instructionsProblem,
  LENGTH_PRESETS,
  LENGTH_RANGE,
  lengthProblem,
  MAX_LICENSE_LENGTH,
  parseLength,
  QUALITIES,
  type Quality,
  SHORT_RANGES,
  SHORTS_COUNT,
  STYLES,
  type Style,
  styleName,
  VISUALS,
  type Visuals,
} from "../lib/settings.ts";
import { CHOICE, cn, HELP, HIDDEN_RADIO, LABEL, LABEL_HINT, WARNING } from "../lib/styles.ts";
import { type Kit, KitCaptionPreview } from "./BrandKits.tsx";
import { CaptionPreview } from "./CaptionPreview.tsx";
import { useT } from "./I18n.tsx";
import { Segments } from "./Segments.tsx";
import { Button } from "./ui/button.tsx";
import { Input, NativeSelect, Textarea } from "./ui/input.tsx";

export interface Choices {
  /** One video, or several shorts from one long video. */
  make: "one" | "shorts";
  /** With several shorts, the range each one's length lies in, by its place in SHORT_RANGES,
   * and how many to make. */
  range: number;
  count: number;
  /** A preset in seconds, or "custom" for the typed length. */
  preset: number | "custom";
  custom: string;
  aspect: Aspect;
  style: Style;
  /** People's names, one per line. */
  names: string;
  /** Other words to hear right, one per line. */
  terms: string;
  /** The licence the music is used under. */
  musicLicense: string;
  /** Where the speech is heard. */
  asr: Asr;
  visuals: Visuals;
  /** Which fillers are cut. */
  fillers: FillerMode;
  quality: Quality;
  /** Whether Claude corrects each transcript. */
  correct: boolean;
  /** The caption style, or "brand" for the brand kit's custom captions. */
  captions: CaptionStyle | "brand";
  /** Whether the captions show the emoji Claude picks. */
  emoji: boolean;
  /** The brand kit, by its id, or none. */
  brand: string | null;
  /** What the user tells Claude about this edit; never kept for the next. */
  instructions: string;
}

/** This computer's memory, and how much the local speech model needs, from the server. */
export interface Machine {
  memory: number;
  needed: number;
}

/** The length the choices ask for, or why there is none, in `t`'s words. A length typed in
 * Chinese units (90 秒, 2 分鐘, 1 小時) reads as the same in English ones. */
export function chosenLength(
  choices: Choices,
  t: Messages = en,
): { seconds: number } | { problem: string } {
  if (choices.preset !== "custom") return { seconds: choices.preset };
  const text = choices.custom
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase()
    .replace(/小時|時/g, "h")
    .replace(/分鐘|分/g, "m")
    .replace(/秒/g, "s");
  if (!text) return { problem: t.settings.typeLength };
  const seconds = parseLength(text.replace(/mins?$/, "m").replace(/(\d)min/, "$1m"));
  if (seconds === null) return { problem: t.settings.lengthExample };
  const problem = lengthProblem(seconds, t);
  return problem ? { problem } : { seconds };
}

interface Props {
  choices: Choices;
  onChange: (choices: Choices) => void;
  /** All the videos' length in seconds, when the browser could read it. */
  footageSeconds: number;
  /** How many music tracks are offered to the edit. */
  music: number;
  /** Null until the server says. */
  machine: Machine | null;
  /** Whether an OpenRouter key is saved; null until the server says. */
  openrouter: boolean | null;
  onAddOpenRouter: () => void;
  /** Whether the optional stock footage keys are saved; null until the server says. */
  stock: { pexels: boolean; pixabay: boolean } | null;
  onAddStock: (service: "pexels" | "pixabay") => void;
  /** The brand kits; null until the server says. */
  kits: Kit[] | null;
  /** Called when the owner picks a kit, after which the default no longer replaces it. */
  onBrand: () => void;
  onEditKits: () => void;
}

/** One of the inspector's sections, divided from the next by a hairline. */
const SECTION =
  "m-0 flex min-w-0 flex-col gap-2.5 border-0 border-t px-6 py-5 first:border-t-0 max-md:px-4";
/** A fieldset's legend, laid out as an ordinary first line. */
const LEGEND = cn(LABEL, "float-left");

/** The silhouette of each aspect, in px. */
const SHAPES: Record<Aspect, string> = {
  "9:16": "h-[34px] w-5",
  "1:1": "size-7",
  "16:9": "h-[23px] w-10",
};

export function SettingsPanel({
  choices,
  onChange,
  footageSeconds,
  music,
  machine,
  openrouter,
  onAddOpenRouter,
  stock,
  onAddStock,
  kits,
  onBrand,
  onEditKits,
}: Props) {
  const t = useT();
  const words = t.settings;
  const id = useId();
  const set = (changes: Partial<Choices>) => onChange({ ...choices, ...changes });
  const length = chosenLength(choices, t);
  const [shortest, longest] = LENGTH_RANGE;
  const asked = instructionsProblem(choices.instructions, t);
  const tooLong = "seconds" in length && footageSeconds > 0 && length.seconds > footageSeconds;

  const several = choices.make === "shorts";
  const kit = kits?.find((each) => each.id === choices.brand) ?? null;
  const [fewest, most] = SHORTS_COUNT;
  const counts = Array.from({ length: most - fewest + 1 }, (_, i) => fewest + i);
  const onOff = (value: boolean) => ({ value, label: value ? words.on : words.off });

  return (
    <>
      <fieldset className={SECTION}>
        <legend className={LEGEND}>{words.what}</legend>
        <Segments
          options={(["one", "shorts"] as const).map((make) => ({
            value: make,
            label: words.whatChoices[make],
          }))}
          value={choices.make}
          // Shorts are watched on phones, so they start vertical.
          onChange={(make) => set({ make, ...(make === "shorts" ? { aspect: "9:16" } : {}) })}
        />
      </fieldset>

      {several ? (
        <>
          <fieldset className={SECTION}>
            <legend className={LEGEND}>{words.shortLength}</legend>
            <Segments
              options={SHORT_RANGES.map(([from, to], i) => ({
                value: i,
                label: formatRange(from, to, t),
              }))}
              value={choices.range}
              onChange={(range) => set({ range })}
            />
            <p className={HELP}>{words.shortLengthHelp}</p>
          </fieldset>
          <fieldset className={SECTION}>
            <legend className={LEGEND}>{words.count}</legend>
            <Segments
              options={counts.map((count) => ({ value: count, label: count }))}
              value={choices.count}
              onChange={(count) => set({ count })}
            />
            <p className={HELP}>{words.countHelp}</p>
          </fieldset>
        </>
      ) : (
        <fieldset className={SECTION}>
          <legend className={LEGEND}>
            {words.length}
            <span className={LABEL_HINT}>
              {words.range(formatLength(shortest, t), formatLength(longest, t))}
            </span>
          </legend>
          <Segments
            options={[
              ...LENGTH_PRESETS.map((seconds) => ({
                value: seconds as number | "custom",
                label: formatLength(seconds, t),
              })),
              { value: "custom" as const, label: words.custom },
            ]}
            value={choices.preset}
            onChange={(preset) => set({ preset })}
          />
          {choices.preset === "custom" && (
            <div className="flex items-center gap-3 animate-in fade-in-0 slide-in-from-top-1 duration-200">
              <Input
                id={`${id}-custom`}
                className="w-40 flex-none"
                inputMode="text"
                autoComplete="off"
                placeholder={words.customPlaceholder}
                aria-label={words.customLabel}
                aria-invalid={"problem" in length && choices.custom.trim() !== ""}
                value={choices.custom}
                autoFocus
                onChange={(event) => set({ custom: event.target.value })}
              />
              <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
                {"seconds" in length
                  ? `= ${formatLength(length.seconds, t)}`
                  : choices.custom.trim()
                    ? length.problem
                    : ""}
              </span>
            </div>
          )}
          {tooLong && <p className={WARNING}>{words.tooLong(formatLength(footageSeconds, t))}</p>}
        </fieldset>
      )}

      <fieldset className={SECTION}>
        <legend className={LEGEND}>{words.aspect}</legend>
        <div className="grid grid-cols-3 gap-2">
          {ASPECTS.map((aspect) => (
            <label key={aspect} className={cn(CHOICE, "group gap-1 px-1.5 pt-3 pb-2.5")}>
              <input
                type="radio"
                name={`${id}-aspect`}
                className={HIDDEN_RADIO}
                value={aspect}
                checked={choices.aspect === aspect}
                onChange={() => set({ aspect })}
              />
              <span className="mb-0.5 grid h-9 place-items-center">
                <span
                  className={cn(
                    "block rounded-[2px] border-[1.5px] border-muted-foreground transition-colors duration-150 group-has-checked:border-foreground group-has-checked:bg-white/10",
                    SHAPES[aspect],
                  )}
                />
              </span>
              <span className="text-[13px] font-semibold">{words.aspects[aspect].name}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {words.aspects[aspect].hint}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className={SECTION}>
        <label className={LABEL} htmlFor={`${id}-instructions`}>
          {words.instructions}
          <span className={LABEL_HINT}>{words.optional}</span>
        </label>
        <Textarea
          id={`${id}-instructions`}
          rows={3}
          placeholder={words.instructionsPlaceholder}
          aria-invalid={asked !== null}
          aria-describedby={`${id}-instructions-help`}
          value={choices.instructions}
          onChange={(event) => set({ instructions: event.target.value })}
        />
        <p id={`${id}-instructions-help`} className={asked ? WARNING : HELP}>
          {asked ?? words.instructionsHelp(INSTRUCTIONS_MAX)}
        </p>
      </div>

      <fieldset className={SECTION}>
        <legend className={LEGEND}>
          {words.style}
          <span className={LABEL_HINT}>{words.optional}</span>
        </legend>
        <Segments
          options={STYLES.map((style) => ({
            value: style,
            label: styleName(style, t),
            describedBy: choices.style === style ? `${id}-style` : undefined,
          }))}
          value={choices.style}
          onChange={(style) => set({ style })}
        />
        <p id={`${id}-style`} className={HELP}>
          {t.looks[choices.style].description}
        </p>
      </fieldset>

      <div className={SECTION}>
        <label className={LABEL} htmlFor={`${id}-brand`}>
          {t.kits.picker}
        </label>
        <NativeSelect
          id={`${id}-brand`}
          value={choices.brand ?? ""}
          onChange={(event) => {
            const picked = kits?.find((kit) => kit.id === event.target.value) ?? null;
            onBrand();
            set({
              brand: picked?.id ?? null,
              captions: picked?.brand.captions
                ? "brand"
                : choices.captions === "brand"
                  ? DEFAULT_CAPTIONS
                  : choices.captions,
            });
          }}
        >
          <option value="">{t.kits.none}</option>
          {kits?.map((kit) => (
            <option key={kit.id} value={kit.id}>
              {kit.brand.name}
            </option>
          ))}
        </NativeSelect>
        <Button
          type="button"
          variant="link"
          size="inline"
          className="self-start"
          onClick={onEditKits}
        >
          {t.kits.edit}
          <ChevronRight aria-hidden="true" />
        </Button>
        <p className={HELP}>{t.kits.pickerHelp}</p>
      </div>

      <fieldset className={SECTION}>
        <legend className={LEGEND}>{words.captionStyle}</legend>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(104px,1fr))] gap-2">
          {kit?.brand.captions && (
            <label className={cn(CHOICE, "gap-1.5 p-1.5 pb-2 text-[13px] font-medium")}>
              <input
                type="radio"
                name={`${id}-captions`}
                className={HIDDEN_RADIO}
                value="brand"
                checked={choices.captions === "brand"}
                onChange={() => set({ captions: "brand" })}
              />
              <KitCaptionPreview kit={kit} />
              <span>{t.kits.captionsName}</span>
            </label>
          )}
          {CAPTION_STYLES.map((captions) => (
            <label
              key={captions}
              className={cn(CHOICE, "gap-1.5 p-1.5 pb-2 text-[13px] font-medium")}
            >
              <input
                type="radio"
                name={`${id}-captions`}
                className={HIDDEN_RADIO}
                value={captions}
                checked={choices.captions === captions}
                onChange={() => set({ captions })}
              />
              <CaptionPreview style={captions} />
              <span>{t.captions[captions].name}</span>
            </label>
          ))}
        </div>
        <p className={HELP}>
          {choices.captions === "brand"
            ? t.kits.captionsDescription
            : t.captions[choices.captions].description}
        </p>
      </fieldset>

      <fieldset className={SECTION}>
        <legend className={LEGEND}>{words.emoji}</legend>
        <Segments
          options={[onOff(false), onOff(true)]}
          value={choices.emoji}
          onChange={(emoji) => set({ emoji })}
        />
        <p className={HELP}>{words.emojiHelp}</p>
      </fieldset>

      <div className={SECTION}>
        <label className={LABEL} htmlFor={`${id}-names`}>
          {words.names}
          <span className={LABEL_HINT}>{words.optional}</span>
        </label>
        <Textarea
          id={`${id}-names`}
          rows={2}
          className="min-h-15"
          placeholder={"王小明\nAlex Chen"}
          value={choices.names}
          onChange={(event) => set({ names: event.target.value })}
        />
        <p className={HELP}>{words.namesHelp}</p>
      </div>

      <div className={SECTION}>
        <label className={LABEL} htmlFor={`${id}-terms`}>
          {words.terms}
          <span className={LABEL_HINT}>{words.optional}</span>
        </label>
        <Textarea
          id={`${id}-terms`}
          rows={2}
          className="min-h-15"
          placeholder={"GPU\nRemotion"}
          value={choices.terms}
          onChange={(event) => set({ terms: event.target.value })}
        />
        <p className={HELP}>{words.termsHelp}</p>
      </div>

      <fieldset className={SECTION}>
        <legend className={LEGEND}>{words.speech}</legend>
        <Segments
          options={[
            { value: "local" as Asr, label: words.local },
            { value: "cloud" as Asr, label: "OpenRouter" },
          ]}
          value={choices.asr}
          onChange={(asr) => set({ asr })}
        />
        {machine && machine.memory < machine.needed && (
          <p className={WARNING}>{words.lowMemory(Math.round(machine.memory / 1024 ** 3))}</p>
        )}
        <p className={HELP}>{choices.asr === "local" ? words.localHelp : words.cloudHelp}</p>
        {choices.asr === "cloud" && openrouter === false && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={onAddOpenRouter}
          >
            {words.addOpenRouter}
          </Button>
        )}
      </fieldset>

      <fieldset className={SECTION}>
        <legend className={LEGEND}>{words.visuals}</legend>
        <Segments
          options={VISUALS.map((visuals) => ({
            value: visuals,
            label: words.visualsChoices[visuals].name,
          }))}
          value={choices.visuals}
          onChange={(visuals) => set({ visuals })}
        />
        <p className={HELP}>{words.visualsChoices[choices.visuals].help}</p>
        {choices.visuals === "rich" && stock && (
          <p className={HELP}>
            {words.stock}{" "}
            {(["pexels", "pixabay"] as const).map((service, i) => (
              <span key={service}>
                {i > 0 && " · "}
                <Button
                  type="button"
                  variant="link"
                  size="inline"
                  className="text-xs"
                  onClick={() => onAddStock(service)}
                >
                  {words.stockKey(service === "pexels" ? "Pexels" : "Pixabay", stock[service])}
                </Button>
              </span>
            ))}
          </p>
        )}
      </fieldset>

      <fieldset className={SECTION}>
        <legend className={LEGEND}>{words.fillers}</legend>
        <Segments
          options={FILLER_MODES.map((fillers) => ({
            value: fillers,
            label: words.fillersChoices[fillers].name,
          }))}
          value={choices.fillers}
          onChange={(fillers) => set({ fillers })}
        />
        <p className={HELP}>{words.fillersChoices[choices.fillers].help}</p>
      </fieldset>

      <details className="group/advanced border-t px-6 py-5 max-md:px-4">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-semibold text-steel transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
          <ChevronRight
            className="size-4 transition-transform duration-200 group-open/advanced:rotate-90"
            aria-hidden="true"
          />
          {words.advanced}
        </summary>
        <div className="flex flex-col gap-5 pt-5">
          <fieldset className="m-0 flex min-w-0 flex-col gap-2.5 border-0 p-0">
            <legend className={LEGEND}>{words.quality}</legend>
            <Segments
              options={QUALITIES.map((quality) => ({
                value: quality,
                label: words.qualities[quality].name,
              }))}
              value={choices.quality}
              onChange={(quality) => set({ quality })}
            />
            <p className={HELP}>{words.qualities[choices.quality].help}</p>
          </fieldset>

          <fieldset className="m-0 flex min-w-0 flex-col gap-2.5 border-0 border-t p-0 pt-5">
            <legend className={LEGEND}>{words.correction}</legend>
            <Segments
              options={[onOff(false), onOff(true)]}
              value={choices.correct}
              onChange={(correct) => set({ correct })}
            />
            <p className={HELP}>{words.correctionHelp}</p>
          </fieldset>
        </div>
      </details>

      {music > 0 && (
        <div className={SECTION}>
          <label className={LABEL} htmlFor={`${id}-license`}>
            {words.license}
          </label>
          <Input
            id={`${id}-license`}
            autoComplete="off"
            maxLength={MAX_LICENSE_LENGTH}
            placeholder="CC0 1.0"
            value={choices.musicLicense}
            onChange={(event) => set({ musicLicense: event.target.value })}
          />
          <p className={HELP}>{words.licenseHelp}</p>
        </div>
      )}
    </>
  );
}
