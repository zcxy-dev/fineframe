---
name: Fineframe
description: Drop in footage, choose a length and an aspect, and get back a finished video.
colors:
  background: "#08090b"
  card: "#0f1013"
  surface: "#15171b"
  raised: "#1d1f24"
  well: "#0b0c0e"
  border: "rgb(255 255 255 / 0.08)"
  edge: "rgb(255 255 255 / 0.15)"
  foreground: "#f2f3f5"
  steel: "#b4b9c1"
  muted-foreground: "#8a8f98"
  laser-amber: "#ffb547"
  laser-amber-hover: "#ffc46d"
  accent-ink: "#1a1408"
  destructive: "#e5654b"
  success: "#7bc29a"
typography:
  title:
    fontFamily: "Geist Variable, Noto Sans TC"
    fontSize: "clamp(26px, 2.6vw, 36px)"
    fontWeight: "800 (Noto Sans TC draws it with its 900 Black)"
    letterSpacing: "-0.04em; zh 0.01em with halt"
  panel-title:
    fontSize: "24px"
    fontWeight: 800
  slug:
    fontSize: "11px; zh 12px"
    fontWeight: 600
    letterSpacing: "0.1em; zh 0.16em"
    textTransform: uppercase
  body:
    fontFamily: "Geist Variable, Noto Sans TC, system-ui, sans-serif"
    fontSize: "14px; controls and labels 13px; hints 12px; transcript words 15px"
    lineHeight: "1.55; zh 1.7"
rounded:
  controls: "8px, buttons 10px"
  frames: "12px to 16px: the drop zone, lists, the player's stage"
  panes: "0: the docked panes"
spacing:
  pane: "40px gutter in the main pane, 24px in the panel; 16px on phones"
  panel: "400px"
components:
  button-primary:
    backgroundColor: "{colors.laser-amber}"
    textColor: "{colors.accent-ink}"
  button-primary-hover:
    backgroundColor: "{colors.laser-amber-hover}"
  segment-selected:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.foreground}"
---

# Design System: Fineframe

## Overview

**The editing room**, the website's visual system brought into the app: a graphite ground where the work sits in viewfinder corners, timelines run under it and words light up as captions do. The page is a docked, full-height tool, as in Descript or CapCut: a top bar, the work in the main pane and a panel on the right, each with its own scroll, so a screen never becomes one long page. Its motion is quieter than the website's: progress, transitions and button feedback only, with no light leaks or film grain.

The components are styled with Tailwind CSS utilities, as the website's are. `app/globals.css` holds the tokens (shadcn/ui's, set to the palette below, plus `steel`, `surface`, `raised`, `well`, `edge`, `amber-hover` and `success`), the keyframes and the motifs a utility cannot say (`display`, `corners`, `viewfinder`, `ruler`, `wave-*`, `hatch`, `sheen`, `chevron`, the caption previews). `lib/styles.ts` holds the class lists several components share. `components/ui/` holds the shadcn/ui and Magic UI components, restyled to this system. The page is dark only, as the website is; `lib/theme.ts` gives its background to the browser and the desktop window.

## Colours

- **Laser amber** (#ffb547 on ink #1a1408, `primary`): the primary action, progress, the playhead, cut points, the lit word and focus. Never a chosen state: a chosen option is steel. The caption previews keep the captions' own colours, which belong to the video.
- **Graphite** (#08090b `background`, #0f1013 `card` for the docked panel, #15171b `surface` for dialogs, menus and the panel's foot, #1d1f24 `raised` for hover and a chosen option, #0b0c0e `well` under video, inputs and the transcript), divided by white hairlines at 8 % (`border`) and 15 % (`edge`).
- **Steel** text in three steps (`foreground`, `steel`, `muted-foreground`), all at least 4.5:1 on the ground.
- **Destructive** (#e5654b) for errors and cuts that land; **success** (#7bc29a) for finished steps and a fixed caption word.

## Typography

One family for every script, as on the website: Geist (variable) for Latin text and numbers, Noto Sans TC for Chinese, both from npm packages (`@fontsource-variable/geist`, `@fontsource/noto-sans-tc`). Screen and panel titles take weight 800 (`display`), which Noto Sans TC meets with its Black; in Chinese they set `halt` and `text-spacing-trim`. A pane section's heading is a slug (`SLUG`: small caps in steel); field labels stay in sentence case at 13px semibold. Numbers are tabular wherever they are data: times, sizes, costs, percentages. Inter is loaded only for the brand kit's sample frame, whose lower third the renderer draws in it.

## Layout

- **Top bar** (56 px): the icon and the name, "Brand kits", the language menu (`components/Language.tsx`: a globe with the page's language, opening the languages, as on the website), the account in the desktop app, and the key.
- **Workspace** (`components/Workspace.tsx`): the work in the main pane, a 400 px panel on the right with its own scroll and its action pinned at its foot. The start screen puts the footage and the projects in the main pane and the settings in the panel, with "Make the video" at its foot; a running edit puts its progress in the main pane and its details and Cancel in the panel; a failed one its reason and next steps in the panel. Brand kits put the sample frame in the main pane and the kits in the panel, with Save at its foot.
- **Editor** (`components/ReEdit.tsx`), for a finished edit: the player in the middle of a dark stage, as large as the stage allows; the transcript under it as a timeline, a ruler over the edit's sound with the cuts asked for, where they land, and the amber playhead, then the words, the one being said lit amber; and on the right a panel whose heading names the edit, with tabs for its result (downloads, export, versions, details), music, look, captions, brand kit, the title and lower thirds and the overlays when the edit has them, and re-plan. "Apply" stays at the panel's foot whichever tab shows, saying what it will render, or the new version's progress.
- Below 1024 px the panes stack, the panel after the work; a failed edit's panel comes first.

## Shapes and depth

Docked panes are square and divided by hairlines; what sits in them takes a radius: controls 8–10 px, frames 12–16 px. Depth is tonal, with real shadows only where something floats: dialogs, menus, the update notice, the panel's foot over its scroll, and the picture on its stage.

## Signature: viewfinder corners

Four L-shaped corners, the shape of the icon. `corners` frames the drop zone and the shorts' players: they open out and turn amber on hover, focus or while footage is dragged over. `viewfinder` keeps them still around the player, the brand kit's sample frame, the version shown and the dialogs. They never mark a chosen option.

## Motion

Motion (`motion`) and tw-animate-css run it, quieter than the website's:

- **Titles** light up word by word as captions do (Magic UI's `text-animate`, its `caption` preset): each word amber for a moment, then steel.
- **Progress:** the run's timeline builds up clip by clip as the edit gets further, with the amber playhead at its edge; the percentage counts on (Magic UI's `number-ticker`); the live stage's amber line draws in along its top; bars fill smoothly.
- **Transitions:** panels, lists, errors and dialogs fade and rise into place; tabs underline in steel.
- **Feedback:** buttons lift a pixel with a sheen crossing them; the drop zone's corners open out and turn amber.
- Under `prefers-reduced-motion` nothing moves: titles stand lit, numbers are written, the caption previews hold one frame.

## Do's and Don'ts

- Do use the tokens and the shared class lists; restyle any new shadcn/ui or Magic UI component to them before it ships.
- Do keep amber to the action, progress, the playhead, cut points, the lit word and focus.
- Do show a chosen option in steel: a raised segment, a steel-framed card, a steel-filled word.
- Don't set field labels or values in caps; slugs head pane sections only.
- Don't add light leaks, film grain or decoration that moves while someone works.
- Don't hard-code the background colour: import it from `lib/theme.ts`.
