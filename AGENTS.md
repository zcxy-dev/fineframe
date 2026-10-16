# Video editor

## Never compromise
- Every rule in [CONTRIBUTING.md](CONTRIBUTING.md#rules).
- Renders have 0 clicks, A/V drift under 10 ms (never join with `-c copy`), no cut inside a word and a length within ±5 % of the target.

## Commands
- Setup, checks and the tests CI skips (the `ml` and `synth` extras, Remotion, Claude) are in [CONTRIBUTING.md](CONTRIBUTING.md#setup).

## Verify
- Run the change for real on the [synthetic corpus](bench/README.md#synthetic-corpus) and look at the result; a pipeline change carries `vebench report` numbers from before and after.
- Update the README's "What works today" and the package README in the same pull request.

## Pitfalls
- In `worker/`, `uv run` without `--extra ml` removes the `ml` extra from the environment; use `uv run --extra ml`.
- Keep one language mode per ASR chunk. The aligner strips non-letters, so `attach_punctuation` in `worker/src/vework/transcribe.py` must stay in step with `split_words_for_alignment` in transformers' Qwen3-ASR processor.
- README.md, `packages/engine/README.md` and `packages/engine/src/plan/plan.ts` conflict between parallel pull requests; rebase right before merging.
