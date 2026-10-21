"use client";

import type { CaptionStyle } from "@video-editor/engine/captions";
import { useId } from "react";
import { en, type Messages } from "../lib/i18n/messages.ts";
import {
  ASPECTS,
  type Aspect,
  type Asr,
  CAPTION_STYLES,
  DEFAULT_CAPTIONS,
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
import { type Kit, KitCaptionPreview } from "./BrandKits.tsx";
import { CaptionPreview } from "./CaptionPreview.tsx";
import styles from "./editor.module.css";
import { useT } from "./I18n.tsx";

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
  quality: Quality;
  /** Whether Claude corrects each transcript. */
  correct: boolean;
  /** The caption style, or "brand" for the brand kit's custom captions. */
  captions: CaptionStyle | "brand";
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

  return (
    <>
      <fieldset className={styles.field}>
        <legend className={styles.label}>{words.what}</legend>
        <div className={styles.chips}>
          {(["one", "shorts"] as const).map((make) => (
            <button
              key={make}
              type="button"
              className={styles.chip}
              aria-pressed={choices.make === make}
              // Shorts are watched on phones, so they start vertical.
              onClick={() => set({ make, ...(make === "shorts" ? { aspect: "9:16" } : {}) })}
            >
              {words.whatChoices[make]}
            </button>
          ))}
        </div>
      </fieldset>

      {several ? (
        <>
          <fieldset className={styles.field}>
            <legend className={styles.label}>{words.shortLength}</legend>
            <div className={styles.chips}>
              {SHORT_RANGES.map(([from, to], i) => (
                <button
                  key={from}
                  type="button"
                  className={styles.chip}
                  aria-pressed={choices.range === i}
                  onClick={() => set({ range: i })}
                >
                  {formatRange(from, to, t)}
                </button>
              ))}
            </div>
            <p className={styles.help}>{words.shortLengthHelp}</p>
          </fieldset>
          <fieldset className={styles.field}>
            <legend className={styles.label}>{words.count}</legend>
            <div className={styles.chips}>
              {counts.map((count) => (
                <button
                  key={count}
                  type="button"
                  className={styles.chip}
                  aria-pressed={choices.count === count}
                  onClick={() => set({ count })}
                >
                  {count}
                </button>
              ))}
            </div>
            <p className={styles.help}>{words.countHelp}</p>
          </fieldset>
        </>
      ) : (
        <fieldset className={styles.field}>
          <legend className={styles.label}>
            {words.length}
            <span className={styles.labelHint}>
              {words.range(formatLength(shortest, t), formatLength(longest, t))}
            </span>
          </legend>
          <div className={styles.chips}>
            {LENGTH_PRESETS.map((seconds) => (
              <button
                key={seconds}
                type="button"
                className={styles.chip}
                aria-pressed={choices.preset === seconds}
                onClick={() => set({ preset: seconds })}
              >
                {formatLength(seconds, t)}
              </button>
            ))}
            <button
              type="button"
              className={styles.chip}
              aria-pressed={choices.preset === "custom"}
              onClick={() => set({ preset: "custom" })}
            >
              {words.custom}
            </button>
          </div>
          {choices.preset === "custom" && (
            <div className={styles.custom}>
              <input
                id={`${id}-custom`}
                className={styles.input}
                inputMode="text"
                autoComplete="off"
                placeholder={words.customPlaceholder}
                aria-label={words.customLabel}
                aria-invalid={"problem" in length && choices.custom.trim() !== ""}
                value={choices.custom}
                // biome-ignore lint/a11y/noAutofocus: the field appears because it was asked for.
                autoFocus
                onChange={(event) => set({ custom: event.target.value })}
              />
              <span className={styles.customOut} aria-live="polite">
                {"seconds" in length
                  ? `= ${formatLength(length.seconds, t)}`
                  : choices.custom.trim()
                    ? length.problem
                    : ""}
              </span>
            </div>
          )}
          {tooLong && (
            <p className={styles.warning}>{words.tooLong(formatLength(footageSeconds, t))}</p>
          )}
        </fieldset>
      )}

      <fieldset className={styles.field}>
        <legend className={styles.label}>{words.aspect}</legend>
        <div className={styles.aspects}>
          {ASPECTS.map((aspect) => (
            <label key={aspect} className={styles.aspect}>
              <input
                type="radio"
                name={`${id}-aspect`}
                className={styles.radio}
                value={aspect}
                checked={choices.aspect === aspect}
                onChange={() => set({ aspect })}
              />
              <span className={styles.shapeBox}>
                <span className={styles.shape} data-aspect={aspect} />
              </span>
              <span className={styles.aspectName}>{words.aspects[aspect].name}</span>
              <span className={styles.aspectHint}>{words.aspects[aspect].hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${id}-instructions`}>
          {words.instructions}
          <span className={styles.labelHint}>{words.optional}</span>
        </label>
        <textarea
          id={`${id}-instructions`}
          className={styles.textarea}
          rows={3}
          placeholder={words.instructionsPlaceholder}
          aria-invalid={asked !== null}
          aria-describedby={`${id}-instructions-help`}
          value={choices.instructions}
          onChange={(event) => set({ instructions: event.target.value })}
        />
        <p id={`${id}-instructions-help`} className={asked ? styles.warning : styles.help}>
          {asked ?? words.instructionsHelp(INSTRUCTIONS_MAX)}
        </p>
      </div>

      <fieldset className={styles.field}>
        <legend className={styles.label}>
          {words.style}
          <span className={styles.labelHint}>{words.optional}</span>
        </legend>
        <div className={styles.chips}>
          {STYLES.map((style) => (
            <button
              key={style}
              type="button"
              className={styles.chip}
              aria-pressed={choices.style === style}
              aria-describedby={choices.style === style ? `${id}-style` : undefined}
              onClick={() => set({ style })}
            >
              {styleName(style, t)}
            </button>
          ))}
        </div>
        <p id={`${id}-style`} className={styles.help}>
          {t.looks[choices.style].description}
        </p>
      </fieldset>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${id}-brand`}>
          {t.kits.picker}
        </label>
        <select
          id={`${id}-brand`}
          className={styles.input}
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
        </select>
        <button type="button" className={styles.linkButton} onClick={onEditKits}>
          {t.kits.edit}
        </button>
        <p className={styles.help}>{t.kits.pickerHelp}</p>
      </div>

      <fieldset className={styles.field}>
        <legend className={styles.label}>{words.captionStyle}</legend>
        <div className={styles.captionStyles}>
          {kit?.brand.captions && (
            <label className={styles.captionStyle}>
              <input
                type="radio"
                name={`${id}-captions`}
                className={styles.radio}
                value="brand"
                checked={choices.captions === "brand"}
                onChange={() => set({ captions: "brand" })}
              />
              <KitCaptionPreview kit={kit} />
              <span className={styles.aspectName}>{t.kits.captionsName}</span>
            </label>
          )}
          {CAPTION_STYLES.map((captions) => (
            <label key={captions} className={styles.captionStyle}>
              <input
                type="radio"
                name={`${id}-captions`}
                className={styles.radio}
                value={captions}
                checked={choices.captions === captions}
                onChange={() => set({ captions })}
              />
              <CaptionPreview style={captions} />
              <span className={styles.aspectName}>{t.captions[captions].name}</span>
            </label>
          ))}
        </div>
        <p className={styles.help}>
          {choices.captions === "brand"
            ? t.kits.captionsDescription
            : t.captions[choices.captions].description}
        </p>
      </fieldset>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${id}-names`}>
          {words.names}
          <span className={styles.labelHint}>{words.optional}</span>
        </label>
        <textarea
          id={`${id}-names`}
          className={styles.textarea}
          rows={2}
          placeholder={"王小明\nAlex Chen"}
          value={choices.names}
          onChange={(event) => set({ names: event.target.value })}
        />
        <p className={styles.help}>{words.namesHelp}</p>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${id}-terms`}>
          {words.terms}
          <span className={styles.labelHint}>{words.optional}</span>
        </label>
        <textarea
          id={`${id}-terms`}
          className={styles.textarea}
          rows={2}
          placeholder={"GPU\nRemotion"}
          value={choices.terms}
          onChange={(event) => set({ terms: event.target.value })}
        />
        <p className={styles.help}>{words.termsHelp}</p>
      </div>

      <fieldset className={styles.field}>
        <legend className={styles.label}>{words.speech}</legend>
        <div className={styles.chips}>
          <button
            type="button"
            className={styles.chip}
            aria-pressed={choices.asr === "local"}
            onClick={() => set({ asr: "local" })}
          >
            {words.local}
          </button>
          <button
            type="button"
            className={styles.chip}
            aria-pressed={choices.asr === "cloud"}
            onClick={() => set({ asr: "cloud" })}
          >
            OpenRouter
          </button>
        </div>
        {machine && machine.memory < machine.needed && (
          <p className={styles.warning}>
            {words.lowMemory(Math.round(machine.memory / 1024 ** 3))}
          </p>
        )}
        <p className={styles.help}>{choices.asr === "local" ? words.localHelp : words.cloudHelp}</p>
        {choices.asr === "cloud" && openrouter === false && (
          <button type="button" className={styles.button} onClick={onAddOpenRouter}>
            {words.addOpenRouter}
          </button>
        )}
      </fieldset>

      <fieldset className={styles.field}>
        <legend className={styles.label}>{words.visuals}</legend>
        <div className={styles.chips}>
          {VISUALS.map((visuals) => (
            <button
              key={visuals}
              type="button"
              className={styles.chip}
              aria-pressed={choices.visuals === visuals}
              onClick={() => set({ visuals })}
            >
              {words.visualsChoices[visuals].name}
            </button>
          ))}
        </div>
        <p className={styles.help}>{words.visualsChoices[choices.visuals].help}</p>
        {choices.visuals === "rich" && stock && (
          <p className={styles.help}>
            {words.stock}{" "}
            {(["pexels", "pixabay"] as const).map((service, i) => (
              <span key={service}>
                {i > 0 && " · "}
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => onAddStock(service)}
                >
                  {words.stockKey(service === "pexels" ? "Pexels" : "Pixabay", stock[service])}
                </button>
              </span>
            ))}
          </p>
        )}
      </fieldset>

      <details className={styles.advanced}>
        <summary className={styles.advancedSummary}>{words.advanced}</summary>
        <div className={styles.advancedBody}>
          <fieldset className={styles.field}>
            <legend className={styles.label}>{words.quality}</legend>
            <div className={styles.chips}>
              {QUALITIES.map((quality) => (
                <button
                  key={quality}
                  type="button"
                  className={styles.chip}
                  aria-pressed={choices.quality === quality}
                  onClick={() => set({ quality })}
                >
                  {words.qualities[quality].name}
                </button>
              ))}
            </div>
            <p className={styles.help}>{words.qualities[choices.quality].help}</p>
          </fieldset>

          <fieldset className={styles.field}>
            <legend className={styles.label}>{words.correction}</legend>
            <div className={styles.chips}>
              {[false, true].map((correct) => (
                <button
                  key={String(correct)}
                  type="button"
                  className={styles.chip}
                  aria-pressed={choices.correct === correct}
                  onClick={() => set({ correct })}
                >
                  {correct ? words.on : words.off}
                </button>
              ))}
            </div>
            <p className={styles.help}>{words.correctionHelp}</p>
          </fieldset>
        </div>
      </details>

      {music > 0 && (
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${id}-license`}>
            {words.license}
          </label>
          <input
            id={`${id}-license`}
            className={styles.input}
            autoComplete="off"
            maxLength={MAX_LICENSE_LENGTH}
            placeholder="CC0 1.0"
            value={choices.musicLicense}
            onChange={(event) => set({ musicLicense: event.target.value })}
          />
          <p className={styles.help}>{words.licenseHelp}</p>
        </div>
      )}
    </>
  );
}
