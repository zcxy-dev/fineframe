---
name: video-editor
description: Edits footage into a finished, captioned video with Fineframe (zcxy-dev/fineframe), or into several shorts, then changes the finished edit by conversation. Use when asked to edit, cut down or caption footage with it, to make shorts from a long video, or to change one of its edits (an edit.project.json): drop or trim a part, fix a caption, change the title, a lower third, a chapter, a motion graphic or B-roll, the music, the look or the brand kit; or to export an edit to Final Cut Pro, DaVinci Resolve or Premiere Pro.
---

# video-editor

`fineframe edit` turns a folder of footage into a finished video at a length and aspect: it analyses each file, has Claude plan the edit, renders it with captions, effects and music, and checks every cut. Everything the video is lives in one file, `<name>.project.json`, so a change is an edit of that file and a re-render, with no new analysis or plan.

The editor runs one of two ways, with the same options:

- **The Fineframe app**, whose menu installs the `fineframe` command: run `fineframe edit` and `fineframe render` from any folder.
- **A clone of the repository**, for working on the editor: run `pnpm -s edit` in place of `fineframe edit` and `pnpm -s render` in place of `fineframe render` throughout, from the repository root: the folder two levels above this skill's `SKILL.md`, once symlinks are resolved (`git -C <that folder> rev-parse --show-toplevel`).

File paths below that start with `packages/` are in the repository: in the clone, or at https://github.com/zcxy-dev/fineframe.

## 1. Check the setup

Done when each of these holds:

- With the app: `fineframe --help` works. If there is no `fineframe` command, ask the user to install the Fineframe app, choose "Install Command Line Tool…" in its menu (the Fineframe menu on macOS, File on Windows and Linux) and open a new terminal. If it says Fineframe is not set up yet, ask them to open the app once and wait until it is ready. `fineframe edit` uses the account the user signed in to in the app, once, and needs a subscription: if it says to sign in, subscribe or connect to the internet, ask the user to do that in the app, then run it again. `fineframe render` needs neither.
- From a clone: `mise --version`, `pnpm --version` and `uv --version` work. If `mise` is missing, ask the user to install it (https://mise.jdx.dev). Then run `mise install`, `pnpm install`, and `uv sync` in `worker/`.
- The key is checked by the edit itself, which fails at once without it. Never read or print `.env` or the keys file in the app's folder. On that error, ask the user to paste their key in the app, or, from a clone, to copy `.env.example` to `.env` and paste their key, or to run `mise run start`.
- `fineframe edit --help` prints the options.

## 2. Make the edit

```bash
mkdir -p out && fineframe edit footage/ --length 60s --aspect 9:16 -o out/edit.mp4 > out/progress.jsonl
```

- Footage: files or folders of video and still images, and links to public videos (YouTube's; other sites may work), fetched beside the output as `<title> [<id>].mp4` (or `.mkv`). Ask before importing a video the user has not said they have the right to use. A playlist, channel, private, members-only, age-restricted or live video fails, saying so. `--length` is 15 s to 1 h (`60s`, `90`, `3m`, `1:30`); `--aspect` is `9:16`, `1:1` or `16:9`.
- Options are in `fineframe edit --help`. What the user wants of the story ("open with the demo", "keep the part about pricing") goes to Claude as `--instructions "<their words>"`. Unless told otherwise, Claude puts a track from the built-in music library under the edit: 40 CC0 tracks tagged calm, upbeat, emotional, corporate or energetic, picked by the video's mood and pace. `--music none` makes an edit without music; `--music <file or folder>` offers the user's own tracks instead (add `--music library` to offer both). Ask before using music the user has not said they have the right to use. Stock footage needs a free Pexels or Pixabay key, saved in the app (from a clone, `PEXELS_API_KEY` or `PIXABAY_API_KEY` in `.env`); without either, visuals are motion graphics and web pages.
- A brand kit (the user's logo, colours, fonts and captions) is a folder: `--brand <folder>` applies it, and the recipe for kits says what the folder holds. Its custom captions replace the caption style unless `--captions` names one. Nothing in it is sent to Claude.
- The first edit of new footage analyses it, about twice the footage's length on a CPU: run it in the background and follow its stderr. Later edits of the same footage start at the plan and take a minute or two. Claude's cost per edit is in the README's [Install](https://github.com/zcxy-dev/fineframe#install) section.
- Done when the last line of `out/progress.jsonl` has `"stage": "done"`. An `"error"` line carries the reason; the stderr says what to change.

**Several shorts** from one long video, when the user asks for shorts or clips to post:

```bash
fineframe edit footage/ --shorts 5 --length 30-60s --aspect 9:16 -o out/shorts > out/progress.jsonl
```

- `--shorts` is how many, 1 to 10; `--length` is the range each one's length lies in (`15-30s`, `30-60s`, `60-90s`, `90s-3m`). Claude finds the moments, each one continuous stretch of one file, and the best are made. `-o` is a new folder.
- Each short is an edit of its own in `out/shorts/01/`, `02/`, … with the files below; `out/shorts/shorts.json` lists them best first, each with its title, description, hashtags, file and stretch (`start`, `end` in seconds), and grows as each one is done. The done line's message says when fewer were made than asked, and why. Report every short's title, description, hashtags and length.
- Changing a short is step 3 inside its folder.

Beside the video: `edit.project.json` (the whole edit), `edit.srt` (the captions), `edit_cuts.json` (where each cut of the newest render in the folder falls, in seconds); with music, `edit.music.txt` (the licences to credit) and, with B-roll or sound effects, `edit.broll.txt` (where each came from, to credit). Tell the user what was made: its length, and what the captions and overlays say.

## 3. Change the edit

Each change makes a new version beside the last, so the user can compare them and go back:

1. Read the project and find what the user means; the recipe says where each thing lives.
2. Find the recipe in [references/recipes.md](references/recipes.md) and follow it. Each recipe either renders with `--cut`, or edits a copy, `edit-v2.project.json` in the same folder (paths in it are relative to its folder), and renders that.
3. Render: `fineframe render out/edit-v2.project.json -o out/edit-v2.mp4`. It validates the project first and names every problem by its JSON path; fix them and render again. A re-render of a one-minute video takes about half a minute on 8 free cores, a few minutes on a busy machine, plus a few seconds for each new or changed overlay.
4. Check the result before reporting it: the length the render prints (`seconds` in its JSON), a frame from where the change is (`ffmpeg -ss <seconds> -i out/edit-v2.mp4 -frames:v 1 frame.png`, then look at the image), and the captions near it in `edit-v2.srt`. Without `ffmpeg` on the PATH, use the renderer's own, `~/.cache/video-editor/ffmpeg-*/ffmpeg` (with `.exe` on Windows). Tell the user what changed and where, and the new length.

The next change starts from the newest version (`edit-v2.project.json`, then `-v3`, …).

## What needs a new plan

These change what the planner chose, so say so to the user and run `fineframe edit` again with the new options, to a new output name such as `out/edit-90s.mp4`; the analysis is cached, so it takes a minute or two and one more Claude plan. Claude decides the story order and what to keep again, so pass what the user asked for, such as which part to put back or move, as `--instructions "<their words>"`:

- A different length beyond ±5 % of the planned one, or a different aspect.
- Putting back something the plan left out, reordering the story, or other footage.
- A track of the user's own other than the one chosen (another library track, its level and its removal are recipes).
- More or fewer fillers cut throughout: `--fillers aggressive` also cuts words that are often verbal tics (然後, 就是, like, you know) where Claude finds they add nothing, and `--fillers off` keeps every word; `natural`, the default, cuts hesitations (嗯, 呃, um) and stutters. One filler is cut with `--cut` (recipes).

A short is planned again from its own file and stretch, with up to 30 s on each side inside the file, into its folder, as a short about its moment: `fineframe edit <its file> --within <start − 30>-<end + 30> --short "<title>. <description>" --length 45s --aspect 9:16 -o out/shorts/01/edit-45s.mp4`, the stretch, title and description from `shorts.json`.

## 4. Export to an editing app

When the user wants to finish an edit in Final Cut Pro, DaVinci Resolve or Premiere Pro:

```bash
fineframe render out/edit.project.json --export out/edit-export
```

- The folder must be empty or new. It gets `edit.fcpxml` (Final Cut Pro and DaVinci Resolve), `edit.xml` (Premiere Pro), `edit.srt`, `README.txt` and `media/`: the B-roll, music and sound effects, and `overlay.mov`, the graphics, titles and watermark over transparency (ProRes 4444) for the top track. The footage is not copied: the timelines name where it is on this computer, so keep `media/` beside them and the footage where it is.
- The timelines carry the cuts, each clip's framing as one position and scale, the B-roll, and the music with its fades and ducking as level keyframes. They leave out the grade, the voice processing, the loudness normalisation, the blurred fill past the picture and a dip's fade (a cut there); tell the user so.
- Done when the JSON it prints lists the files.
