---
name: Video Editor
description: Drop in footage, choose a length and an aspect, and get back a finished video.
colors:
  bg: "#0b0b0d"
  surface: "#141417"
  surface-2: "#1b1b1f"
  surface-3: "#232328"
  border: "#2a2a31"
  border-strong: "#3a3a43"
  text: "#f1f1f3"
  text-2: "#b4b4bd"
  muted: "#8a8a95"
  caption-yellow: "#ffd43b"
  caption-yellow-hover: "#ffdd63"
  accent-ink: "#141414"
  danger: "#ff6b6b"
  success: "#5ad19a"
  light-bg: "#f6f6f4"
  light-surface: "#ffffff"
  light-text: "#17171a"
typography:
  display:
    fontFamily: "Inter Variable, Noto Sans TC, system-ui, sans-serif"
    fontSize: "clamp(30px, 3.6vw, 44px)"
  xl:
    fontSize: "24px"
  lg:
    fontSize: "18px"
  md:
    fontFamily: "Inter Variable, Noto Sans TC, system-ui, sans-serif"
    fontSize: "15px"
    lineHeight: 1.5
  sm:
    fontSize: "14px"
  xs:
    fontSize: "12.5px"
rounded:
  sm: "10px"
  md: "16px"
spacing:
  "0.5": "2px"
  "1": "4px"
  "1.5": "6px"
  "2": "8px"
  "2.5": "10px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "7": "28px"
  "8": "32px"
  "10": "40px"
  "12": "48px"
  "14": "56px"
components:
  button-primary:
    backgroundColor: "{colors.caption-yellow}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.sm}"
  button-primary-hover:
    backgroundColor: "{colors.caption-yellow-hover}"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
---

# Design System: Video Editor

## Overview

**Creative North Star: "The Quiet Darkroom"**

The page is where footage goes in and a finished video comes out, so the interface steps back and the work leads, as in professional editing suites. Neutral, near-black surfaces in a few tonal steps carry the controls; the one colour is the captions' yellow, which the edit itself uses, and it marks the next action. Density is moderate: one task per screen (drop, set, run, result), with progress always visible during a long run.

The incumbent look is kept. Tokens live in `app/globals.css`; `components/editor.module.css` uses them.

**Key Characteristics:**
- Near-black tonal layers, no decorative colour.
- One accent, the caption yellow, for the primary action, focus and progress.
- A light theme from `prefers-color-scheme`, with the same roles.

## Colors

Neutral greys with one warm accent.

### Primary
- **Caption Yellow** (#ffd43b): the primary button, focus rings in the dark theme, progress and selected chips. The same yellow the captions use, so the page and the video share it.

### Neutral
- **Darkroom Black** (#0b0b0d; light #f6f6f4): the page background, also the desktop window's and the browser's theme colour, from one source (`lib/theme.ts`).
- **Surfaces** (#141417, #1b1b1f, #232328): panels, inputs and hovered rows, lightest on top.
- **Borders** (#2a2a31, #3a3a43): dividers and input edges; the strong one for hover and emphasis.
- **Text** (#f1f1f3, #b4b4bd, #8a8a95): primary, secondary and muted.
- **Danger** (#ff6b6b) and **Success** (#5ad19a): errors and finished steps only.

**The One Accent Rule.** Yellow appears only on the next action, focus and progress; never as decoration.

## Typography

**Font:** Inter Variable with Noto Sans TC for Chinese, then the platform's sans.

### Hierarchy
- **Display** (`clamp(30px, 3.6vw, 44px)`): the page title only. The run's percentage is its own numeral display (52px, 40px on narrow screens).
- **xl** (24px, `--text-xl`): panel and run titles.
- **lg** (18px, `--text-lg`): the drop zone's title.
- **md** (15px, `--text-md`): body, the brand, the primary button, the lede.
- **sm** (14px, `--text-sm`): controls, labels, file names, messages.
- **xs** (12.5px, `--text-xs`): hints, metadata, step details.

**The Five Steps Rule.** Text outside the two displays uses one of the five steps; no one-off sizes.

## Layout

A single centred column with panels. Spacing comes from a 4px scale with half steps for tight groups: `--space-0-5` (2px) to `--space-14` (56px). Tight groups use 4–8px, controls within a panel 10–16px, panels and sections 20–32px, page edges 24–56px. Below 720px the title, lede, run title and percentage step down.

## Elevation & Depth

Mostly tonal layering; one soft shadow (`--shadow`) lifts panels from the background, with an inset 1px highlight in the dark theme.

## Shapes

Two radii: `--radius` (16px) for panels and the drop zone, `--radius-sm` (10px) for buttons, inputs and chips.

## Do's and Don'ts

- Do use the tokens in `app/globals.css` for colour, size, spacing and radius.
- Do keep the yellow for the next action.
- Don't add sizes outside the five steps or spacing outside the scale.
- Don't hard-code the background colour: import it from `lib/theme.ts`.
