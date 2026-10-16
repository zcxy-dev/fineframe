# Contributing

Plans and open work are [GitHub issues](https://github.com/zcxy-dev/video-editor/issues).

## Setup

Set up the TypeScript workspace and the worker as in the [README quick start](README.md#quick-start). The benchmark is its own `uv` project:

```bash
cd bench
uv sync
uv run vebench --help
```

CI installs neither the worker's `ml` extra nor the benchmark's `synth` extra, so it skips the tests that need them. Run them locally when you change those parts: `uv sync --extra ml` in `worker/`, `uv sync --extra synth` in `bench/`, then `uv run pytest`. CI also skips the [engine test that renders the effect templates with Remotion](packages/engine/README.md#tests). Tests that call the Claude API run only with your own key: `uv run --env-file ../.env pytest -m claude` in `worker/` ([details](worker/README.md#transcript-correction)), and `CLAUDE_TESTS=1 node --env-file=../../.env --test src/plan/plan.test.ts` in `packages/engine/`.

## Checks

A change passes the steps in [`.github/workflows/ci.yml`](.github/workflows/ci.yml). Run the same commands locally before opening a pull request. Its `macos` and `macos-intel` jobs run the engine tests on Apple silicon and on Intel and score a [synthetic edit](packages/engine/scripts/synthetic-edit.ts), one run of it with effect overlays rendered by Remotion, with `vebench report`: every run except `copy-joined`, a deliberately naive baseline joined with `-c copy`, must have no clicks and under 10 ms of drift. `pnpm exec biome check --write` fixes TypeScript and JSON formatting.

## Where code goes

- **Python:** model analysis (`worker/`) and the benchmark (`bench/`). Qwen3-ASR, TransNetV2, Silero and PyTorch have no TypeScript equivalents.
- **TypeScript:** everything else, in the pnpm workspace: the web page (`apps/web`), the planner, the renderer and captions (`packages/engine`) and the effects (`packages/effects`). The one exception is the benchmark's [blind-review page](bench/README.md#blind-review): its script is JavaScript that the Python server serves as is, with no build step, and `pnpm lint` and `pnpm typecheck` check it.
- **JSON Schemas:** [`packages/schema`](packages/schema/) defines the files passed between the two. Types and the worker's model are generated from it.

## Rules

- **Measure pipeline changes.** A change to analysis, planning or rendering comes with `vebench report` numbers from before and after it. Measure on the [synthetic corpus](bench/README.md#synthetic-corpus), and on your own [corpus](bench/README.md#corpus-layout) if you have one.
- **Fix bugs test-first.** A bug fix starts with a test that fails for the bug's reason.
- **Keep data synthetic.** Tests generate their own media (ffmpeg `lavfi`, synthetic tones).
- **Corpus footage** follows [bench/README.md](bench/README.md#corpus-layout).
- **Never commit** other people's media, credentials or `.env` files.
- **Keep third-party notices in one file.** A new model, font, program or dependency gets a row in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md#components) with its licence, checked against its own licence file or model card. Code adapted from another project keeps that project's copyright and licence in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), which lists the files it is in. The project is named nowhere else: not in code, comments, docs, tests, commits or pull requests. Its brand assets (logos, product names) are not covered by its licence; don't copy them.

## Pull requests

Branch as `feat/`, `fix/`, `chore/` or `docs/` from the latest `main`, give the pull request a [Conventional Commits](https://www.conventionalcommits.org) title and fill in the template. Pull requests are squash-merged once CI is green.
