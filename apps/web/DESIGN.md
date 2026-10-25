---
name: Fineframe
description: Drop in footage, choose a length and an aspect, and get back a finished video.
colors:
  background: "#f3f4f6"
  card: "#ffffff"
  surface: "#ffffff"
  raised: "#eceef1"
  well: "#f3f4f6"
  border: "#dfe2e7"
  edge: "#c9cdd3"
  foreground: "#0c0d10"
  steel: "#3d424b"
  muted-foreground: "#5d636d"
  amber: "#ffb547"
  amber-hover: "#ffc46d"
  graphite: "#16181c"
  destructive: "#d4472f"
  success: "#1e7a4c"
typography:
  title:
    fontFamily: "Geist Variable, Noto Sans TC"
    fontSize: "clamp(26px, 2.6vw, 36px)"
    fontWeight: "700; zh 900 (Noto Sans TC Black)"
    letterSpacing: "-0.035em; zh 0.01em with palt"
  panel-title:
    fontSize: "24px"
    fontWeight: "700; zh 900"
  slug:
    fontSize: "11px; zh 12px"
    fontWeight: 600
    letterSpacing: "0.1em; zh 0.16em"
    textTransform: uppercase
  body:
    fontFamily: "Geist Variable, Noto Sans TC, system-ui, sans-serif"
    fontSize: "14px; controls and labels 13px; hints 12px; transcript words 15px"
    lineHeight: "1.55; zh 1.75 with 0.02em tracking"
rounded:
  controls: "pills: buttons, option chips, the language menu"
  fields: "8px: inputs and selects"
  frames: "12px to 16px: lists, choice cards, the progress stages, the transcript"
  cards: "24px: the drop zone, dialogs, the brand kit's sample"
  panes: "0: the docked panes"
spacing:
  pane: "40px gutter in the main pane, 24px in the panel; 16px on phones"
  panel: "400px"
stroke: "1.5px: icons, outlined buttons, option chips, viewfinder corners"
components:
  button-primary:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.foreground}"
  button-primary-hover:
    backgroundColor: "{colors.amber-hover}"
  option-selected:
    backgroundColor: "{colors.foreground}"
    textColor: "{colors.card}"
---

# Design System: Fineframe

## Overview

**Direction A**, the website's visual system brought into the app: a light ground, white panels, ink type and one amber, flat colour with one stroke width, and no glow or gradient. The page is a docked, full-height tool, as in Descript or CapCut: a top bar, the work in the main pane and a panel on the right, each with its own scroll, so a screen never becomes one long page. It shares the website's tokens (ground, paper, ink in three steps, line, amber, steel, graphite and cut, the 24 px card radius and the 1.5 px stroke) at a tool's sizes: the same faces and heading styles, with smaller body text.

The components are styled with Tailwind CSS utilities, as the website's are. `app/globals.css` holds the tokens (shadcn/ui's, set to the palette below, plus `steel`, `surface`, `raised`, `well`, `edge`, `amber-hover`, `graphite`, `success` and `stroke`), the keyframes and the motifs a utility cannot say (`display`, `corners`, `viewfinder`, `ruler`, `wave-*`, `hatch`, `chevron`, the caption previews). `lib/styles.ts` holds the class lists several components share. `components/ui/` holds the shadcn/ui and Magic UI components, restyled to this system. The page is light only, as the website is; `lib/theme.ts` gives its background to the browser and the desktop window.

## Colours

- **Ground and paper:** the main pane sits on the light ground (#f3f4f6 `background`, also `well` under the player, the transcript and small frames); the top bar, the docked panel, lists, fields, dialogs and menus are white (`card`, `surface`), divided by the line (#dfe2e7 `border`) and, where a control needs a firmer edge, steel (#c9cdd3 `edge`, `input`). Hover is a 5 % ink wash (`accent`) or #eceef1 (`raised`).
- **Ink** text in three steps (#0c0d10 `foreground`, #3d424b `steel`, #5d636d `muted-foreground`), each at least 5:1 on the ground and on white. Focus rings, progress, playheads and a chosen option are ink.
- **Amber** (#ffb547, `primary`) is a fill with ink on it, never a line or text on white, where it would not read: the primary action, the word being said, the active step and the selection. A chosen option is ink, never amber.
- **Graphite** (#16181c) is the dark ground the caption previews sit on; video sits on black. The caption previews keep the captions' own colours, which belong to the video, as the brand kit's sample frame does.
- **Cut** (#d4472f, `destructive`) for errors and cuts that land, as icons, marks and fills; error text itself is ink. **Success** (#1e7a4c) for finished steps and a fixed caption word.

## Typography

One family for every script, as on the website: Geist (variable) for Latin text and numbers, Noto Sans TC for Chinese, both from npm packages (`@fontsource-variable/geist`, `@fontsource/noto-sans-tc`). Screen and panel titles (`display`) take Geist 700 tracked to −0.035em, and in Chinese Noto Sans TC Black with `palt`. A pane section's heading is a slug (`SLUG`: small caps in steel); field labels stay in sentence case at 13px semibold. Numbers are tabular wherever they are data: times, sizes, costs, percentages. Inter is loaded only for the brand kit's sample frame, whose lower third the renderer draws in it.

## Layout

- **Top bar** (56 px, white): the icon and the name, "Brand kits", the language menu (`components/Language.tsx`: a globe with the page's language, opening the languages, as on the website), the account in the desktop app, and the key.
- **Workspace** (`components/Workspace.tsx`): the work in the main pane, a 400 px white panel on the right with its own scroll and its action pinned at its foot. The start screen puts the footage and the projects in the main pane and the settings in the panel, with "Make the video" at its foot; a running edit puts its progress in the main pane and its details and Cancel in the panel; a failed one its reason and next steps in the panel. Brand kits put the sample frame in the main pane and the kits in the panel, with Save at its foot.
- **Editor** (`components/ReEdit.tsx`), for a finished edit: the player in the middle of the ground, as large as the stage allows; the transcript under it on white as a timeline, a ruler over the edit's sound with the cuts asked for, where they land, and the ink playhead, then the words, the one being said on amber; and on the right a panel whose heading names the edit, with tabs for its result (downloads, export, versions, details), music, look, captions, brand kit, the title and lower thirds and the overlays when the edit has them, and re-plan. "Apply" stays at the panel's foot whichever tab shows, saying what it will render, or the new version's progress.
- Below 1024 px the panes stack, the panel after the work; a failed edit's panel comes first.

## Shapes and depth

Docked panes are square and divided by hairlines; what sits in them takes a radius: buttons and option chips are pills, fields 8 px, frames 12–16 px, cards and dialogs 24 px. Depth is tonal, with soft shadows only where something floats: dialogs, menus, the update notice, the panel's foot over its scroll, and the picture on its stage.

## Options

A choice of a few values is a row of pills (`SEGMENTS`, `SEGMENT`): the chosen one is filled in ink with white text. A choice shown as a picture, an aspect or a caption style, is a white card (`CHOICE`) framed in ink when chosen. A ticked box and a slider's value are ink.

## Signature: viewfinder corners

Four L-shaped corners, the shape of the icon, drawn in the 1.5 px stroke. `corners` frames the drop zone and the shorts' players: they open out and darken to ink on hover, focus or while footage is dragged over. `viewfinder` keeps them still around the player, the brand kit's sample frame, the version shown and the dialogs. They never mark a chosen option.

## Motion

Motion (`motion`) and tw-animate-css run it, quieter than the website's:

- **Titles** come in word by word as captions do (Magic UI's `text-animate`, its `caption` preset).
- **Progress:** the run's timeline builds up clip by clip as the edit gets further, with the ink playhead at its edge; the percentage counts on (Magic UI's `number-ticker`); the live stage's ink line draws in along its top; bars fill smoothly.
- **Transitions:** panels, lists, errors and dialogs fade and rise into place; tabs underline in ink.
- **Feedback:** buttons lift a pixel; the drop zone's corners open out and darken.
- Under `prefers-reduced-motion` nothing moves: titles stand, numbers are written, the caption previews hold one frame.

## Do's and Don'ts

- Do use the tokens and the shared class lists; restyle any new shadcn/ui or Magic UI component to them before it ships.
- Do keep amber to fills with ink on them: the action, the word being said, the active step and the selection.
- Do show a chosen option in ink: a filled pill, an ink-framed card, an ink tick.
- Don't set field labels or values in caps; slugs head pane sections only.
- Don't add glows, gradients, film grain or decoration that moves while someone works.
- Don't hard-code the background colour: import it from `lib/theme.ts`.
