"use client";

import { useId } from "react";
import {
  ASPECTS,
  type Aspect,
  formatLength,
  LENGTH_PRESETS,
  LENGTH_RANGE,
  lengthProblem,
  MAX_LICENSE_LENGTH,
  parseLength,
  STYLE_TEXT,
  STYLES,
  type Style,
  styleName,
} from "../lib/settings.ts";
import styles from "./editor.module.css";

export interface Choices {
  /** A preset in seconds, or "custom" for the typed length. */
  preset: number | "custom";
  custom: string;
  aspect: Aspect;
  style: Style;
  names: string;
  /** The licence the music is used under. */
  musicLicense: string;
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
}

export function SettingsPanel({ choices, onChange, footageSeconds, music }: Props) {
  const id = useId();
  const set = (changes: Partial<Choices>) => onChange({ ...choices, ...changes });
  const length = chosenLength(choices);
  const [shortest, longest] = LENGTH_RANGE;
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
          Names and terms
          <span className={styles.labelHint}>Optional</span>
        </label>
        <textarea
          id={`${id}-names`}
          className={styles.textarea}
          rows={3}
          placeholder={"王小明\nGPU"}
          value={choices.names}
          onChange={(event) => set({ names: event.target.value })}
        />
        <p className={styles.help}>
          One per line, spelled as the captions should show them. Helps the speech model hear names,
          brands and jargon.
        </p>
      </div>

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
