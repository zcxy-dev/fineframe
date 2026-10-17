# Video editor

## Never compromise
- Every rule in [CONTRIBUTING.md](CONTRIBUTING.md#rules).
- Renders have 0 clicks, A/V drift under 10 ms (never join with `-c copy`), no cut inside a word and a length within ±5 % of the target.

## Commands
- Setup, checks and the tests CI skips (the `ml` and `synth` extras, Chrome for Remotion and web capture, Claude) are in [CONTRIBUTING.md](CONTRIBUTING.md#setup).

## Verify
- Run the change for real on the [synthetic corpus](bench/README.md#synthetic-corpus) and look at the result.
- Update the README's "What works today" and the package README in the same pull request; a pipeline change that is measured again updates `packages/engine/MEASUREMENTS.md`.
- A change to `pnpm edit`/`pnpm render` options or the effects catalogs' limits updates `skills/video-editor` in the same pull request; `packages/effects/src/recipes.test.ts` checks the `project.json` paths it names.

## Pitfalls
- Keep one language mode per ASR chunk.
- README.md, `packages/engine/README.md`, `packages/engine/MEASUREMENTS.md` and `packages/engine/src/plan/plan.ts` conflict between parallel pull requests; rebase right before merging.
