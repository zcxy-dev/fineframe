"use client";

import { rgba } from "@video-editor/effects/layout";
import { PRESETS, type Preset } from "@video-editor/engine/captions";
import { type CSSProperties, Fragment, useId } from "react";
import {
  ASPECTS,
  type Aspect,
  type Asr,
  CAPTION_STYLES,
  formatLength,
  INSTRUCTIONS_MAX,
  instructionsProblem,
  LENGTH_PRESETS,
  LENGTH_RANGE,
  lengthProblem,
  MAX_LICENSE_LENGTH,
  parseLength,
  QUALITIES,
  type Quality,
  STYLE_TEXT,
  STYLES,
  type Style,
  styleName,
  VISUALS,
  type Visuals,
} from "../lib/settings.ts";
import styles from "./editor.module.css";

export interface Choices {
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
  /** The caption preset. */
  captions: string;
  /** What the user tells Claude about this edit; never kept for the next. */
  instructions: string;
}

/** This computer's memory, and how much the local speech model needs, from the server. */
export interface Machine {
  memory: number;
  needed: number;
}

/** The length the choices ask for, or why there is none. */
export function chosenLength(choices: Choices): { seconds: number } | { problem: string } {
  if (choices.preset !== "custom") return { seconds: choices.preset };
  const text = choices.custom.trim().replace(/\s+/g, "").toLowerCase();
  if (!text) return { problem: "Type a length" };
  const seconds = parseLength(text.replace(/mins?$/, "m").replace(/(\d)min/, "$1m"));
  if (seconds === null) return { problem: "Type a length such as 90 s, 2:30 or 1 h" };
  const problem = lengthProblem(seconds);
  return problem ? { problem } : { seconds };
}

const VISUALS_TEXT: Record<Visuals, { name: string; help: string }> = {
  rich: {
    name: "Rich",
    help: "Claude adds B-roll to each point: motion-graphics cards, web pages, stock footage and logos, beside the speaker or full frame, with soft sound effects.",
  },
  minimal: { name: "Minimal", help: "Only the footage you dropped in, cut and captioned." },
};

const QUALITY_TEXT: Record<Quality, { name: string; help: string }> = {
  best: { name: "Best", help: "Claude Opus plans the edit and judges the doubtful cuts." },
  economy: {
    name: "Economy",
    help: "Claude Sonnet plans the edit and judges the doubtful cuts, for about half the cost.",
  },
};

const ASPECT_LABELS: Record<Aspect, { name: string; hint: string }> = {
  "9:16": { name: "Vertical", hint: "9:16 · phones" },
  "1:1": { name: "Square", hint: "1:1 · feeds" },
  "16:9": { name: "Wide", hint: "16:9 · screens" },
};

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
}: Props) {
  const id = useId();
  const set = (changes: Partial<Choices>) => onChange({ ...choices, ...changes });
  const length = chosenLength(choices);
  const [shortest, longest] = LENGTH_RANGE;
  const asked = instructionsProblem(choices.instructions);
  const tooLong = "seconds" in length && footageSeconds > 0 && length.seconds > footageSeconds;

  return (
    <>
      <fieldset className={styles.field}>
        <legend className={styles.label}>
          Length
          <span className={styles.labelHint}>
            {formatLength(shortest)} to {formatLength(longest)}
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
              {formatLength(seconds)}
            </button>
          ))}
          <button
            type="button"
            className={styles.chip}
            aria-pressed={choices.preset === "custom"}
            onClick={() => set({ preset: "custom" })}
          >
            Custom
          </button>
        </div>
        {choices.preset === "custom" && (
          <div className={styles.custom}>
            <input
              id={`${id}-custom`}
              className={styles.input}
              inputMode="text"
              autoComplete="off"
              placeholder="90 s, 2:30, 1 h"
              aria-label="Custom length"
              aria-invalid={"problem" in length && choices.custom.trim() !== ""}
              value={choices.custom}
              // biome-ignore lint/a11y/noAutofocus: the field appears because it was asked for.
              autoFocus
              onChange={(event) => set({ custom: event.target.value })}
            />
            <span className={styles.customOut} aria-live="polite">
              {"seconds" in length
                ? `= ${formatLength(length.seconds)}`
                : choices.custom.trim()
                  ? length.problem
                  : ""}
            </span>
          </div>
        )}
        {tooLong && (
          <p className={styles.warning}>
            Longer than all of the footage ({formatLength(footageSeconds)}); the edit can only keep
            what was said.
          </p>
        )}
      </fieldset>

      <fieldset className={styles.field}>
        <legend className={styles.label}>Aspect</legend>
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
              <span className={styles.aspectName}>{ASPECT_LABELS[aspect].name}</span>
              <span className={styles.aspectHint}>{ASPECT_LABELS[aspect].hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${id}-instructions`}>
          Tell Claude what you want
          <span className={styles.labelHint}>Optional</span>
        </label>
        <textarea
          id={`${id}-instructions`}
          className={styles.textarea}
          rows={3}
          placeholder={"Focus on the product demo\nLeave out the small talk at the start"}
          aria-invalid={asked !== null}
          aria-describedby={`${id}-instructions-help`}
          value={choices.instructions}
          onChange={(event) => set({ instructions: event.target.value })}
        />
        <p id={`${id}-instructions-help`} className={asked ? styles.warning : styles.help}>
          {asked ??
            `What to keep, leave out or open with, in up to ${INSTRUCTIONS_MAX} characters. Only for this edit: the next one starts empty.`}
        </p>
      </div>

      <fieldset className={styles.field}>
        <legend className={styles.label}>
          Style
          <span className={styles.labelHint}>Optional</span>
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
              {styleName(style)}
            </button>
          ))}
        </div>
        <p id={`${id}-style`} className={styles.help}>
          {STYLE_TEXT[choices.style]}
        </p>
      </fieldset>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${id}-names`}>
          People's names
          <span className={styles.labelHint}>Optional</span>
        </label>
        <textarea
          id={`${id}-names`}
          className={styles.textarea}
          rows={2}
          placeholder={"王小明\nAlex Chen"}
          value={choices.names}
          onChange={(event) => set({ names: event.target.value })}
        />
        <p className={styles.help}>
          One per line, spelled as the captions should show them. Helps the speech model hear them,
          and a lower third can show them.
        </p>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${id}-terms`}>
          Terms
          <span className={styles.labelHint}>Optional</span>
        </label>
        <textarea
          id={`${id}-terms`}
          className={styles.textarea}
          rows={2}
          placeholder={"GPU\nRemotion"}
          value={choices.terms}
          onChange={(event) => set({ terms: event.target.value })}
        />
        <p className={styles.help}>
          Brands, products and jargon, one per line. Only helps the speech model hear them; never
          shown as a name. Both lists are kept for your next edit.
        </p>
      </div>

      <fieldset className={styles.field}>
        <legend className={styles.label}>Speech</legend>
        <div className={styles.chips}>
          <button
            type="button"
            className={styles.chip}
            aria-pressed={choices.asr === "local"}
            onClick={() => set({ asr: "local" })}
          >
            On this computer
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
            This computer has {Math.round(machine.memory / 1024 ** 3)} GB of memory, and the speech
            model needs about 9 GB of it, so speech is heard on OpenRouter.
          </p>
        )}
        <p className={styles.help}>
          {choices.asr === "local"
            ? "The most accurate, and nothing is sent; it needs about 9 GB of memory and downloads 3.4 GB the first time."
            : "Qwen3-ASR hears the speech on OpenRouter with your OpenRouter key, for about US$0.03 an hour of footage. Only the speech audio is sent; the words are timed on this computer."}
        </p>
        {choices.asr === "cloud" && openrouter === false && (
          <button type="button" className={styles.button} onClick={onAddOpenRouter}>
            Add your OpenRouter key
          </button>
        )}
      </fieldset>

      <fieldset className={styles.field}>
        <legend className={styles.label}>Visuals</legend>
        <div className={styles.chips}>
          {VISUALS.map((visuals) => (
            <button
              key={visuals}
              type="button"
              className={styles.chip}
              aria-pressed={choices.visuals === visuals}
              onClick={() => set({ visuals })}
            >
              {VISUALS_TEXT[visuals].name}
            </button>
          ))}
        </div>
        <p className={styles.help}>{VISUALS_TEXT[choices.visuals].help}</p>
        {choices.visuals === "rich" && stock && (
          <p className={styles.help}>
            Stock footage needs a free Pexels or Pixabay key; optional.{" "}
            {(["pexels", "pixabay"] as const).map((service, i) => (
              <span key={service}>
                {i > 0 && " · "}
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => onAddStock(service)}
                >
                  {service === "pexels" ? "Pexels" : "Pixabay"}{" "}
                  {stock[service] ? "key saved · Replace" : "key"}
                </button>
              </span>
            ))}
          </p>
        )}
      </fieldset>

      <details className={styles.advanced}>
        <summary className={styles.advancedSummary}>Advanced settings</summary>
        <div className={styles.advancedBody}>
          <fieldset className={styles.field}>
            <legend className={styles.label}>Quality</legend>
            <div className={styles.chips}>
              {QUALITIES.map((quality) => (
                <button
                  key={quality}
                  type="button"
                  className={styles.chip}
                  aria-pressed={choices.quality === quality}
                  onClick={() => set({ quality })}
                >
                  {QUALITY_TEXT[quality].name}
                </button>
              ))}
            </div>
            <p className={styles.help}>{QUALITY_TEXT[choices.quality].help}</p>
          </fieldset>

          <fieldset className={styles.field}>
            <legend className={styles.label}>Transcript correction</legend>
            <div className={styles.chips}>
              {[false, true].map((correct) => (
                <button
                  key={String(correct)}
                  type="button"
                  className={styles.chip}
                  aria-pressed={choices.correct === correct}
                  onClick={() => set({ correct })}
                >
                  {correct ? "On" : "Off"}
                </button>
              ))}
            </div>
            <p className={styles.help}>
              Claude reads each transcript with your names and terms and fixes what the speech model
              misheard, before its words are timed. Adds a Claude cost.
            </p>
          </fieldset>

          <fieldset className={styles.field}>
            <legend className={styles.label}>Caption style</legend>
            <div className={styles.captionStyles}>
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
                  <CaptionPreview preset={PRESETS[captions] as Preset} />
                  <span className={styles.aspectName}>
                    {`${captions[0]?.toUpperCase()}${captions.slice(1)}`}
                  </span>
                </label>
              ))}
            </div>
            <p className={styles.help}>{PRESETS[choices.captions]?.description}.</p>
          </fieldset>
        </div>
      </details>

      {music > 0 && (
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${id}-license`}>
            Music licence
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
          <p className={styles.help}>
            Use only music you have the right to use; this licence covers every track. Claude picks
            the track that fits, or none, and sets it under the voice.
          </p>
        </div>
      )}
    </>
  );
}

/** The words a preview shows; the second is being spoken. */
const SAMPLE = ["Every", "word", "on", "time"];

/** A caption preset drawn with CSS from its own values, over a dark frame: an approximation of
 * what libass draws, to choose by. */
function CaptionPreview({ preset }: { preset: Preset }) {
  const em = (value: number) => `${value}em`;
  const shadows = [
    preset.shadow &&
      `0 ${em(preset.shadow.offset)} ${em(preset.shadow.blur)} ${rgba(preset.shadow.color, preset.shadow.opacity)}`,
    preset.glow && `0 0 ${em(preset.glow.blur)} ${rgba(preset.glow.color, preset.glow.opacity)}`,
  ].filter(Boolean);
  const text: CSSProperties = {
    color: preset.text,
    fontWeight: preset.weight,
    fontSize: em(preset.scale),
    letterSpacing: em(preset.tracking),
    ...(shadows.length > 0 ? { textShadow: shadows.join(", ") } : {}),
    // A stroke drawn under the fill, as libass draws its border outside the glyph.
    ...(preset.stroke
      ? {
          WebkitTextStroke: `${em(preset.stroke.width * 2)} ${preset.stroke.color}`,
          paintOrder: "stroke fill",
        }
      : {}),
    ...(preset.plate
      ? {
          background: rgba(preset.plate.color, preset.plate.opacity),
          padding: `${em(preset.plate.padY)} ${em(preset.plate.padX)}`,
          borderRadius: em(preset.plate.radius),
        }
      : {}),
  };
  const active: CSSProperties = preset.pill
    ? {
        color: preset.active,
        background: preset.pill.color,
        padding: `${em(preset.pill.padY)} ${em(preset.pill.padX)}`,
        borderRadius: em(preset.pill.radius),
        WebkitTextStroke: "0",
      }
    : preset.sweep
      ? { position: "relative", display: "inline-block" }
      : { color: preset.active };
  return (
    <span className={styles.captionFrame} aria-hidden="true">
      <span className={styles.captionText} style={text}>
        {SAMPLE.map((word, i) => (
          <Fragment key={word}>
            {i > 0 && " "}
            <span
              style={
                i === 1
                  ? active
                  : i > 1 && preset.upcoming < 1
                    ? { opacity: preset.upcoming }
                    : preset.sweep && i === 0
                      ? { color: preset.active }
                      : undefined
              }
            >
              {word}
              {i === 1 && preset.sweep && (
                // Part of the way through the word, as the colour sweeps.
                <span className={styles.captionSweep} style={{ color: preset.active }}>
                  {word}
                </span>
              )}
            </span>
          </Fragment>
        ))}
      </span>
    </span>
  );
}
