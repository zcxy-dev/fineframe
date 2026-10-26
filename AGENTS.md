# Fineframe

Automatic video editor: footage and a target length in, a finished cut with captions out. A pnpm workspace (web page, Electron desktop app, planner and renderer) plus two `uv` projects: `worker/` (analysis) and `bench/` (benchmark). Public repository.

## Commands
- Dev: `mise run start` (port 3000; `PORT=3001 mise run start` if taken)
- Check before a PR (what CI runs): `pnpm install --frozen-lockfile && pnpm lint && pnpm knip && pnpm typecheck && pnpm test && pnpm check-gen`; in `worker/` (with `UV_NO_GROUP=ml`) and in `bench/`: `uv sync --locked && uv run ruff format --check . && uv run ruff check . && uv run pytest -q`; in `bench/`: `uv run vebench tables --check`; after a workflow change: `actionlint` and `zizmor --config .github/zizmor.yml .github/`.
- CI also runs the engine tests on macOS and Windows (the `macos` and `windows` checks). What CI skips (the worker's `big` ml tests, the `synth` extra, Chrome for HyperFrames and web capture, tests that call the Claude API) is in [CONTRIBUTING.md](CONTRIBUTING.md#setup).

## Release
- A merge to `main` never deploys; release only on Jason's explicit yes (for a big release he first tries a CI build of `main` on his Mac). A release is the tag `v<version>`, where the version is `apps/desktop/package.json`'s: `desktop.yml` builds the installers and uploads them with the update feed to Cloudflare R2, served at downloads.fineframe.app. Nothing goes to GitHub releases.
- Version PR: the same version in the five workspace `package.json` files and in `worker/pyproject.toml` and `bench/pyproject.toml` (then `uv lock` in each); merge it, then push an annotated `v<version>` tag.
- Health: `https://downloads.fineframe.app/latest-mac.yml` (and `latest.yml`, `latest-linux.yml`) reports the released `version`; compare an installer with `SHA256SUMS` there. It names no commit.
- Preview for user-visible changes: the web page with `tailscale serve` on the tailnet; the desktop app from the PR's `installer-*` artifact of the `desktop` run.

## Notes
- No review bots here: babysit PRs with `pr-wait --until green`.
- Renders have 0 clicks, A/V drift under 10 ms (never join with `-c copy`), no cut inside a word and a length within ±5 % of the target. The other rules every change follows are in [CONTRIBUTING.md](CONTRIBUTING.md#rules).
- Verify a pipeline change on the [synthetic corpus](bench/README.md#synthetic-corpus) and look at the result; a measured change updates `packages/engine/MEASUREMENTS.md`. A change to `pnpm edit`/`pnpm render` options or the effects catalogs' limits updates `skills/video-editor` in the same pull request (`packages/effects/src/recipes.test.ts` checks the `project.json` paths it names).
- Keep one language mode per ASR chunk.
- `packages/engine/MEASUREMENTS.md` and `packages/engine/src/plan/plan.ts` conflict between parallel pull requests; rebase right before merging. A table in a `<!-- results:… -->` block comes from `bench/results/`: change the JSON and run `uv run vebench tables` in `bench/`.
