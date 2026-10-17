---
name: video-editor
description: Edits footage into a finished, captioned video with the open-source video-editor (zcxy-dev/video-editor), then changes the finished edit by conversation. Use when asked to edit, cut down or caption footage with it, or to change one of its edits (an edit.project.json): drop or trim a part, fix a caption, change the title, a lower third, a keyword or chapter, a card or B-roll, the music or the look.
---

# video-editor

`pnpm edit` turns a folder of footage into a finished video at a length and aspect: it analyses each file, has Claude plan the edit, renders it with captions, effects and music, and checks every cut. Everything the video is lives in one file, `<name>.project.json`, so a change is an edit of that file and a re-render, with no new analysis or plan.

Run every command from the repository root: the folder two levels above this skill's `SKILL.md`, once symlinks are resolved (`git -C <that folder> rev-parse --show-toplevel`).

## 1. Check the setup

Done when each of these holds:

- `mise --version`, `pnpm --version` and `uv --version` work. If `mise` is missing, ask the user to install it (https://mise.jdx.dev). Then run `mise install`, `pnpm install`, and `uv sync` in `worker/`.
- The key is checked by the edit itself, which fails at once without it. Never read or print `.env`. On that error, ask the user to copy `.env.example` to `.env` and paste their key, or to run `mise run start`.
- `pnpm edit --help` prints the options.

## 2. Make the edit

```bash
mkdir -p out && pnpm -s edit footage/ --length 60s --aspect 9:16 -o out/edit.mp4 > out/progress.jsonl
```

- Footage: files or folders of video and still images. `--length` is 15 s to 1 h (`60s`, `90`, `3m`, `1:30`); `--aspect` is `9:16`, `1:1` or `16:9`.
- Options are in `pnpm edit --help`. Ask before using music the user has not said they have the right to use. Stock footage needs a free `PEXELS_API_KEY` or `PIXABAY_API_KEY` in `.env`; without either, B-roll comes from cards and pages.
- The first edit of new footage analyses it, about twice the footage's length on a CPU: run it in the background and follow its stderr. Later edits of the same footage start at the plan and take a minute or two. Claude costs about US$0.05 to 0.20 an edit, more for long ones.
- Done when the last line of `out/progress.jsonl` has `"stage": "done"`. An `"error"` line carries the reason; the stderr says what to change.

Beside the video: `edit.project.json` (the whole edit), `edit.srt` (the captions), `edit_cuts.json` (where each cut of the newest render in the folder falls, in seconds); with music, `edit.music.txt` (the licences to credit) and, with B-roll or sound effects, `edit.broll.txt` (where each came from, to credit). Tell the user what was made: its length, and what the captions and overlays say.

## 3. Change the edit

Each change makes a new version beside the last, so the user can compare them and go back:

1. Read the project and find what the user means; the recipe says where each thing lives.
2. Find the recipe in [references/recipes.md](references/recipes.md) and follow it. Each recipe either renders with `--cut`, or edits a copy, `edit-v2.project.json` in the same folder (paths in it are relative to its folder), and renders that.
3. Render: `pnpm -s render out/edit-v2.project.json -o out/edit-v2.mp4`. It validates the project first and names every problem by its JSON path; fix them and render again. A re-render of a one-minute video takes about half a minute on 8 free cores, a few minutes on a busy machine, plus a few seconds for each new or changed overlay.
4. Check the result before reporting it: the length the render prints (`seconds` in its JSON), a frame from where the change is (`ffmpeg -ss <seconds> -i out/edit-v2.mp4 -frames:v 1 frame.png`, then look at the image), and the captions near it in `edit-v2.srt`. Without `ffmpeg` on the PATH, use the renderer's own, which `node -e 'import("./packages/engine/src/ffmpeg.ts").then(async (m) => console.log(await m.ffmpeg()))'` prints. Tell the user what changed and where, and the new length.

The next change starts from the newest version (`edit-v2.project.json`, then `-v3`, …).

## What needs a new plan

These change what the planner chose, so say so to the user and run `pnpm edit` again with the new options, to a new output name such as `out/edit-90s.mp4`; the analysis is cached, so it takes a minute or two and one more Claude plan:

- A different length beyond ±5 % of the planned one, or a different aspect.
- Putting back something the plan left out, reordering the story, or other footage.
- A different music track than the one chosen (its level and removal are recipes).
