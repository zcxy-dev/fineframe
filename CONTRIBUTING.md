# Contributing

Plans and open work are [GitHub issues](https://github.com/zcxy-dev/fineframe/issues). Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

Set up the TypeScript workspace and the worker as in the [README quick start](README.md#quick-start). The benchmark is its own `uv` project:

```bash
cd bench
uv sync
uv run vebench --help
```

CI's `windows` job runs the worker's `ml` tests except those marked `big`, which load the speech model; CI runs none of the benchmark's `synth` tests. The `ml` group is a default one, so `uv sync` and `uv run` in `worker/` install it; `--no-group ml` leaves it out. Run the rest locally when you change those parts: `uv sync` in `worker/`, `uv sync --extra synth` in `bench/`, then `uv run pytest`. CI also skips the tests that need Chrome: the Remotion renders of templates (`engine/src/render.test.ts`) and cards (`effects/src/cards.test.ts`), and web capture (`engine/src/broll/capture.test.ts`); run them when you change those parts. Tests that call the Claude API run only with your own key: `uv run --env-file ../.env pytest -m claude` in `worker/` ([details](worker/README.md#transcript-correction)), and `CLAUDE_TESTS=1 node --env-file=../../.env --test src/plan/plan.test.ts` in `packages/engine/`.

## Checks

A change passes the steps in [`.github/workflows/ci.yml`](.github/workflows/ci.yml); run them locally before opening a pull request. Every synthetic edit CI renders has no clicks and under 10 ms of drift, except `copy-joined`, a deliberately naive baseline joined with `-c copy`. `pnpm exec biome check --write` fixes TypeScript and JSON formatting.

## Where code goes

- **Python:** model analysis (`worker/`) and the benchmark (`bench/`). Qwen3-ASR, TransNetV2, Silero and PyTorch have no TypeScript equivalents.
- **TypeScript:** everything else, in the pnpm workspace: the web page (`apps/web`), the desktop app around it (`apps/desktop`), the planner, the renderer and captions (`packages/engine`) and the effects (`packages/effects`). The one exception is the benchmark's [blind-review page](bench/README.md#blind-review): its script is JavaScript that the Python server serves as is, with no build step, and `pnpm lint` and `pnpm typecheck` check it.
- **JSON Schemas:** [`packages/schema`](packages/schema/) defines the files passed between the two. Types and the worker's model are generated from it.

## Rules

- **Measure pipeline changes.** A change to analysis, planning or rendering comes with `vebench report` numbers from before and after it. Measure on the [synthetic corpus](bench/README.md#synthetic-corpus), and on your own [corpus](bench/README.md#corpus-layout) if you have one.
- **Fix bugs test-first.** A bug fix starts with a test that fails for the bug's reason.
- **Keep data synthetic.** Tests generate their own media (ffmpeg `lavfi`, synthetic tones).
- **Corpus footage** follows [bench/README.md](bench/README.md#corpus-layout).
- **Never commit** other people's media, credentials or `.env` files.
- **Keep third-party notices in one file.** A new model, font, program or dependency gets a row in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md#components) with its licence, checked against its own licence file or model card. Code adapted from another project keeps that project's copyright and licence in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), which lists the files it is in; no other file carries its copyright, licence or attribution. Its brand assets (logos, product names) are not covered by its licence; don't copy them.

## Pull requests

Branch as `feat/`, `fix/`, `chore/` or `docs/` from the latest `main`, give the pull request a [Conventional Commits](https://www.conventionalcommits.org) title and fill in the template. Pull requests are squash-merged once CI is green.
