# Fineframe

Automatic video editor: footage and a target length in, a finished cut with captions out. A pnpm workspace (web page, Electron desktop app, planner and renderer, and the fineframe.app website in `apps/site`) plus two `uv` projects: `worker/` (analysis) and `bench/` (benchmark). Public repository.

## Commands
- Dev: `mise run start` (port 3000; `PORT=3001 mise run start` if taken)
- Check before a PR (what CI runs): `pnpm install --frozen-lockfile && pnpm lint && pnpm knip && pnpm typecheck && pnpm test && pnpm check-gen`; in `worker/` (with `UV_NO_GROUP=ml`) and in `bench/`: `uv sync --locked && uv run ruff format --check . && uv run ruff check . && uv run basedpyright && uv run pytest -q`; in `bench/`: `uv run vebench tables --check`; after a workflow change: `actionlint` and `zizmor --config .github/zizmor.yml .github/`; after a Markdown change: `git ls-files -z '*.md' | xargs -0 lychee --offline --include-fragments --index-files 'README.md,.'` (lychee 0.24.2, as `ci.yml` pins it).
- What CI skips (the worker's `big` ml tests, the `synth` extra, Chrome for HyperFrames and web capture, tests that call the Claude API) is in [CONTRIBUTING.md](CONTRIBUTING.md#setup).

## Release
- A merge to `main` never deploys the app; releasing needs a yes first. A merge that changes `apps/site/` deploys fineframe.app: work there follows [apps/site/AGENTS.md](apps/site/AGENTS.md). A release is the tag `v<version>`, where the version is `apps/desktop/package.json`'s: `desktop.yml` builds the installers and uploads them with the update feed to Cloudflare R2, served at downloads.fineframe.app. Installers never go to GitHub releases. The bucket also serves the music library (`music/v1/`), the Beat This! checkpoint (`models/`), the benchmark corpus (`corpus/`) and the README's example media (`examples/`).
- Version PR: the same version in the five workspace `package.json` files and in `worker/pyproject.toml` and `bench/pyproject.toml` (then `uv lock` in each); merge it, then push an annotated `v<version>` tag.
- Health: `https://downloads.fineframe.app/latest-mac.yml` (and `latest.yml`, `latest-linux.yml`) reports the released `version`; compare an installer with `SHA256SUMS` there. It names no commit.
- The same task names as every app, in [`mise.toml`](mise.toml): `mise run dev`, `check`, `test`, `preview`, `screenshots:update`, `deploy`.
- Preview: every pull request (except Markdown or docs only) builds the desktop app's installers (`desktop`), linked on the pull request; the website's preview is its Cloudflare Pages preview ([apps/site/AGENTS.md](apps/site/AGENTS.md)). The app and the site are used by customers: a PR that changes `apps/site`, `apps/web` or `apps/desktop`'s pages, components or assets, or the screenshot baselines, merges only after the owner adds the `owner-ok` label (the `owner-ok` check); send the preview links and the screenshot comparison. Releasing the app (the `v<version>` tag) still needs the owner's yes.

## Notes
- Renders have 0 clicks, A/V drift under 10 ms (never join with `-c copy`), no cut inside a word and a length within ±5 % of the target. The other rules every change follows are in [CONTRIBUTING.md](CONTRIBUTING.md#rules).
- Pipeline changes: measure as in [CONTRIBUTING.md](CONTRIBUTING.md#rules), and update `packages/engine/MEASUREMENTS.md` when the numbers move. A change to `pnpm edit`/`pnpm render` options or the effects catalogs' limits updates `skills/video-editor` in the same pull request (`packages/effects/src/recipes.test.ts` checks the `project.json` paths it names).
- `packages/engine/MEASUREMENTS.md` and `packages/engine/src/plan/plan.ts` conflict between parallel pull requests; rebase right before merging. A table in a `<!-- results:… -->` block comes from `bench/results/`: change the JSON and run `uv run vebench tables` in `bench/`.
- Keep `video-editor` in the cache folder `~/.cache/video-editor`, the `@video-editor/*` package names, the root package name and the skill `video-editor`: installed apps, caches and CI use them. The product and the repository are Fineframe.
- UI changes in `apps/web` follow [DESIGN.md](apps/web/DESIGN.md) (tokens, amber rules, do's and don'ts) and [PRODUCT.md](apps/web/PRODUCT.md).
