# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Anyone, in any field, who has footage and wants a finished video without editing it by hand. No one group is targeted: the page must work for a first-time user with no editing vocabulary as well as for someone who edits every week.

## Product Purpose
A fully automatic video editor. The person drops in footage, picks a length and an aspect ratio, and gets back a finished video: cut, captioned, framed, graded and animated, with no manual steps. Success is a video they can publish as it comes out. The goal is the strongest automatic video editor there is.

## Positioning
The edit is made end to end with no timeline to touch: analysis, planning, rendering and a check of every cut run locally, with Claude planning the edit. It is built for Mandarin, English and speech that switches between them, with captions in Taiwan Traditional Chinese.

## Operating Context
- The web page (`apps/web`) is the one interface; the desktop app (`apps/desktop`) runs the same page in an Electron window on Apple silicon Macs, Windows and Linux.
- A run takes minutes: the page shows progress through analyse, plan, render and check, then the result with its files.
- The person brings their own Anthropic API key, entered on the page.
- The desktop app asks for a signed-in Fineframe account before an edit (free during the public beta).

## Capabilities and Constraints
- Inputs: video, audio, images and music files; settings for length, aspect ratio, visuals and names.
- Outputs: the video, its captions, credits and the project file the agent skill can change later.
- Analysis and rendering run on the person's machine; what is sent out is listed in `SECURITY.md`.

## Brand Commitments
The name is "Fineframe". Its icon is in the repository's `brand/` folder, with the wordmark in Archivo SemiExpanded; the page shows the 32 px version (`public/icon.svg`) beside the name set in Geist bold, as the website sets it, and `app/favicon.ico` holds the 16 and 32 px ones. The interface takes the website's visual system, direction A: a light ground, white panels, ink type and one amber, as DESIGN.md sets out.

## Evidence on Hand
The README's example frames and videos from a CC BY 3.0 interview (`downloads.fineframe.app/examples/v0.2.0/`). No testimonials, customers or usage numbers exist; none may be invented.

## Product Principles
- No manual editing steps: every choice the page asks for must be one a newcomer can answer.
- Show what is happening during a long run, and what came out at the end.
- Say plainly what leaves the machine.

## Accessibility & Inclusion
WCAG 2.2 AA: contrast, keyboard operation and zoom.
