# Fineframe

Automatic video editor: footage and a target length in, a finished cut with captions out. A pnpm workspace (web page, Electron desktop app, planner and renderer) plus two `uv` projects: `worker/` (analysis) and `bench/` (benchmark). Public repository.

## Commands
- Dev: `mise run start` (port 3000; `PORT=3001 mise run start` if taken)
- Check before a PR (what CI runs): `pnpm install --frozen-lockfile && pnpm lint && pnpm knip && pnpm typecheck && pnpm test && pnpm check-gen`; in `worker/` (with `UV_NO_GROUP=ml`) and in `bench/`: `uv sync --locked && uv run ruff format --check . && uv run ruff check . && uv run pytest -q`; in `bench/`: `uv run vebench tables --check`; after a workflow change: `actionlint` and `zizmor --config .github/zizmor.yml .github/`.
- What CI skips (the worker's `big` ml tests, the `synth` extra, Chrome for HyperFrames and web capture, tests that call the Claude API) is in [CONTRIBUTING.md](CONTRIBUTING.md#setup).

## Release
- A merge to `main` never deploys; releasing needs a yes first. A release is the tag `v<version>`, where the version is `apps/desktop/package.json`'s: `desktop.yml` builds the installers and uploads them with the update feed to Cloudflare R2, served at downloads.fineframe.app. Installers never go to GitHub releases. The bucket also serves the music library (`music/v1/`), the Beat This! checkpoint (`models/`), the benchmark corpus (`corpus/`) and the README's example media (`examples/`); the GitHub releases `v0.2.0` and `corpus-synthetic-seed0-v1` and `zcxy-dev/fineframe-music` hold old copies only.
- Version PR: the same version in the five workspace `package.json` files and in `worker/pyproject.toml` and `bench/pyproject.toml` (then `uv lock` in each); merge it, then push an annotated `v<version>` tag.
- Health: `https://downloads.fineframe.app/latest-mac.yml` (and `latest.yml`, `latest-linux.yml`) reports the released `version`; compare an installer with `SHA256SUMS` there. It names no commit.
- Preview for user-visible changes: the desktop app from the PR's `installer-*` artifact of the `desktop` run; the web page as in the global rules.

## Notes
- Renders have 0 clicks, A/V drift under 10 ms (never join with `-c copy`), no cut inside a word and a length within ±5 % of the target. The other rules every change follows are in [CONTRIBUTING.md](CONTRIBUTING.md#rules).
- Pipeline changes: measure as in [CONTRIBUTING.md](CONTRIBUTING.md#rules), and update `packages/engine/MEASUREMENTS.md` when the numbers move. A change to `pnpm edit`/`pnpm render` options or the effects catalogs' limits updates `skills/video-editor` in the same pull request (`packages/effects/src/recipes.test.ts` checks the `project.json` paths it names).
- `packages/engine/MEASUREMENTS.md` and `packages/engine/src/plan/plan.ts` conflict between parallel pull requests; rebase right before merging. A table in a `<!-- results:… -->` block comes from `bench/results/`: change the JSON and run `uv run vebench tables` in `bench/`.
- Keep `video-editor` in the cache folder `~/.cache/video-editor`, the `@video-editor/*` package names, the root package name and the skill `video-editor`: installed apps, caches and CI use them. The product and the repository are Fineframe.
- UI changes in `apps/web` follow [DESIGN.md](apps/web/DESIGN.md) (tokens, amber rules, do's and don'ts) and [PRODUCT.md](apps/web/PRODUCT.md).
