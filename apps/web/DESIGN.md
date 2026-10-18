---
name: Fineframe
description: Drop in footage, choose a length and an aspect, and get back a finished video.
colors:
  pane: "#1c1d21"
  inspector: "#17181b"
  topbar: "#141518"
  viewer: "#111215"
  well: "#121316"
  raised: "#24262b"
  line: "#2e3036"
  line-strong: "#3a3d44"
  text: "#e6e8eb"
  text-2: "#a9adb5"
  muted: "#8b8f97"
  laser-amber: "#ffb547"
  laser-amber-hover: "#ffc46d"
  accent-ink: "#1a1408"
  danger: "#e0807a"
  success: "#7bc29a"
  light-bg: "#f6f6f4"
  light-inspector: "#eeeeec"
  light-text: "#17181b"
typography:
  display:
    fontFamily: "Archivo Variable (font-stretch 112.5%, SemiExpanded), Inter Variable, Noto Sans TC, sans-serif"
    fontSize: "26px"
    fontWeight: 600
  slug:
    fontFamily: "Archivo Variable (font-stretch 112.5%)"
    fontSize: "11.5px"
    fontWeight: 600
    letterSpacing: "0.06em"
    textTransform: uppercase
  xl:
    fontSize: "24px"
  lg:
    fontSize: "17px"
  md:
    fontFamily: "Inter Variable, Noto Sans TC, system-ui, sans-serif"
    fontSize: "15px"
    lineHeight: 1.5
  sm:
    fontSize: "13.5px"
  xs:
    fontSize: "12.5px"
rounded:
  controls: "2px"
  panes: "0"
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
    backgroundColor: "{colors.laser-amber}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.controls}"
  button-primary-hover:
    backgroundColor: "{colors.laser-amber-hover}"
  segment-selected:
    backgroundColor: "{colors.text}"
    textColor: "{colors.pane}"
  inspector:
    backgroundColor: "{colors.inspector}"
---

# Design System: Fineframe

## Overview

**Creative North Star: "The Proof Sheet"**

A press proof: one sheet divided by hairlines, with crop marks around the work. The page is a docked, full-height app, as in Final Cut Pro or DaVinci Resolve: a top bar, the work in the main pane and the settings in an inspector on the right, sharing one hairline edge. Nothing floats; panes and sections are divided by 1px lines. The materials are the icon's: graphite sheets, steel type and marks, and one amber laser line for what is live or next.

Tokens live in `app/globals.css`; `components/editor.module.css` uses them. The page background comes from `lib/theme.ts`.

**Key Characteristics:**
- Graphite panes in a few tonal steps, divided by hairlines; no cards, shadows or glow.
- Steel for type, marks and the chosen option; amber only for the primary action, progress and focus.
- Crop marks frame only the work itself.
- Dark first; a light theme from `prefers-color-scheme` keeps the same roles, less tuned.

## Colors

### Primary
- **Laser Amber** (#ffb547, ink #1a1408): the primary button, progress fills, the active stage's top line, focus rings, range and checkbox accents. Never decoration and never a chosen state. The caption previews keep the captions' own colours, which belong to the video.

### Neutral
- **Pane** (#1c1d21; light #f6f6f4): the main pane and the page's background (`lib/theme.ts`).
- **Inspector** (#17181b), **Top bar** (#141518), **Viewer** (#111215): the docked panes, darkest where the picture plays.
- **Well** (#121316): inputs, segmented tracks, the transcript; **Raised** (#24262b): hover and chosen cards.
- **Lines** (#2e3036, strong #3a3d44): every division and control edge.
- **Steel** (#e6e8eb, #a9adb5, #8b8f97): primary, secondary and muted text, all at least 4.5:1 on the panes.
- **Danger** (#e0807a) and **Success** (#7bc29a): errors and finished steps only.

**The One Laser Rule.** Amber marks what is live or next, once per view where it can; a chosen option is steel.

## Typography

**Faces:** Archivo SemiExpanded (`"Archivo Variable"` with `font-stretch: 112.5%`) for the wordmark, screen titles and slugs; Inter Variable with Noto Sans TC for everything else. Numbers are tabular wherever they are data: times, sizes, costs, percentages.

### Hierarchy
- **Display** (Archivo 600, 26px; 22px on phones): screen titles, such as the compose title and "Making your edit"; panel titles 22px.
- **Slug** (Archivo 600, 11.5px caps, 0.06em): a pane section's heading only (Footage, Projects, Versions, Change the edit and its sections, the analysis steps). Field labels are never slugs.
- **xl** (24px), **lg** (17px): the run's percentage and the drop zone's title.
- **md** (15px): body and transcript words.
- **sm** (13.5px): controls, labels, file names, messages. Field labels are 600 in the inspector.
- **xs** (12.5px): hints, metadata, step details.

## Layout

A full-height grid: a 44px top bar, then the main pane and a 360px inspector (320px below 1024px) with its own scroll and the primary action pinned at its foot. Sections inside a pane are divided by hairlines with 20–24px padding. Spacing comes from the 4px scale in `app/globals.css`. Below 720px the panes stack, the inspector after the work, and on a finished edit the result and its downloads come before the re-edit.

## Elevation & Depth

None by shadow: depth is the tonal step between panes and the hairline between them. The key dialog alone casts a shadow, over a dimmed page.

## Shapes

Panes are square; controls and inputs take a 2px radius. Segmented controls join their options with hairline dividers.

## Signature: crop marks

Four L-shaped corners (`--crop`, `--crop-sm`) in steel at 40% frame the drop zone, the player and the version shown. They turn amber while footage is dragged over the drop zone. They never mark a chosen option or decorate a section.

## Do's and Don'ts

- Do use the tokens in `app/globals.css` for colour, size, spacing and radius.
- Do show a chosen option in steel: a filled segment, a steel-framed card, a steel-filled word.
- Don't use amber for anything but the primary action, progress and focus.
- Don't set field labels or values in caps; slugs head pane sections only.
- Don't add cards, shadows or glows to panes.
- Don't hard-code the background colour: import it from `lib/theme.ts`.
