import argparse
import json
import subprocess
import sys
from importlib.metadata import version
from pathlib import Path

from vebench import beats, edit, mix, render, review, shots, speakers, tables, transcript
from vebench.synth import corpus, published

TRANSCRIPT_NAMES = ("transcript.json", "transcript.srt", "transcript.txt")
MEDIA_NAMES = ("output.mp4", "output.mov", "output.mkv", "output.wav")
RESULT_KEYS = (
    "clips",
    "transcript",
    "shots",
    "speakers",
    "render",
    "mix",
    "edit",
    "missing",
    "errors",
)


def main(argv: list[str] | None = None) -> None:
    """Run one vebench command and print its result as JSON; `synth` prints what it wrote.

    `review` serves the rating page until Ctrl+C, and `review-report` prints Markdown.
    Exits with 1 on a failure, and from `report` when any output failed to score.
    """
    args = _parser().parse_args(argv)
    try:
        if args.command == "review":
            review.serve(args.round, args.rater, args.seed, args.port)
            return
        if args.command == "review-report":
            print(review.report(args.round), end="")
            return
        if args.command == "tables":
            stale = tables.write(check=args.check)
            for doc in stale:
                verb = (
                    "is out of date; run `uv run vebench tables` in bench/"
                    if args.check
                    else "written"
                )
                print(f"vebench: {doc} {verb}", file=sys.stderr)
            if args.check and stale:
                sys.exit(1)
            return
        if args.command == "transcript":
            result = transcript.score(transcript.load(args.ref), transcript.load(args.hyp))
        elif args.command == "shots":
            result = shots.score(
                shots.load_truth(args.ref), shots.load_cuts(args.hyp), args.tolerance
            )
        elif args.command == "speakers":
            turns = speakers.compare(speakers.load(args.ref), speakers.load(args.hyp))
            result = speakers.summarize([turns])
        elif args.command == "render":
            result = render.check(args.media, shots.load_cuts(args.cuts))
        elif args.command == "mix":
            result = mix.check(
                args.voice, args.music, mix.joins(args.project) if args.project else []
            )
        elif args.command == "beats":
            result = beats.score(args.ref, args.hyp)
        elif args.command == "edit":
            result = edit.score(args.project)
        elif args.command == "synthetic":
            published.download(args.out)
            result = {"corpus": str(args.out), "sha256": published.SHA256}
        elif args.command == "synth":
            result = corpus.generate(
                args.out, args.seed, lambda message: print(f"vebench: {message}", file=sys.stderr)
            )
        else:
            result = report(args.corpus, args.tolerance)
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as exc:
        print(f"vebench: error: {exc}", file=sys.stderr)
        sys.exit(1)
    json.dump(result, sys.stdout, indent=2, ensure_ascii=False)
    print()
    if args.command == "report" and any(s["errors"] for s in result.values()):
        sys.exit(1)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="vebench",
        description="Score video-editing output against hand-checked ground truth.",
        epilog="Corpus layout and metric definitions: bench/README.md",
    )
    parser.add_argument("--version", action="version", version=f"vebench {version('vebench')}")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser(
        "tables",
        help="write the measurement tables in the docs from bench/results/*.json",
        epilog="Format: bench/README.md#results-tables",
    )
    p.add_argument("--check", action="store_true", help="fail if a table is out of date instead")

    p = sub.add_parser("transcript", help="error rate and word timing of one transcript")
    p.add_argument("--ref", type=Path, required=True, help="truth transcript (JSON, SRT or text)")
    p.add_argument("--hyp", type=Path, required=True, help="transcript under test")

    p = sub.add_parser("shots", help="shot-boundary precision and recall of one detection")
    p.add_argument("--ref", type=Path, required=True, help="truth shots.json with transitions")
    p.add_argument("--hyp", type=Path, required=True, help="detected cut times (JSON)")
    p.add_argument(
        "--tolerance",
        type=float,
        default=0.1,
        help="seconds a cut may be off (default: %(default)s)",
    )

    p = sub.add_parser("speakers", help="how often one system names who is talking")
    p.add_argument("--ref", type=Path, required=True, help="truth speakers.json with turns")
    p.add_argument("--hyp", type=Path, required=True, help="the system's speakers.json")

    p = sub.add_parser("render", help="clicks at the cuts and A/V drift of one rendered edit")
    p.add_argument("--media", type=Path, required=True, help="rendered video or audio file")
    p.add_argument(
        "--cuts",
        type=Path,
        required=True,
        help="JSON list of cut times in the rendered timeline, in seconds",
    )

    p = sub.add_parser(
        "mix",
        help="how far the voice stands over the music while talking, from a render's stems",
        epilog="The renderer writes the stems with its stems option: bench/README.md#metrics",
    )
    p.add_argument("--voice", type=Path, required=True, help="the voice stem (voice.wav)")
    p.add_argument("--music", type=Path, required=True, help="the music stem (music.wav)")
    p.add_argument(
        "--project", type=Path, help="the rendered project.json, whose music joins are checked"
    )

    p = sub.add_parser("beats", help="beat and downbeat F-measure and tempo of one music index")
    p.add_argument("--ref", type=Path, required=True, help="beat truth, such as beat-112.json")
    p.add_argument("--hyp", type=Path, required=True, help="the track's music index")

    p = sub.add_parser(
        "edit",
        help="length, cuts inside words, fillers, retakes, dead air, beats and callouts of one "
        "planned edit",
        epilog="Each source is scored against <its clip>/truth: bench/README.md#edit-truth",
    )
    p.add_argument("--project", type=Path, required=True, help="the edit's project.json")

    p = sub.add_parser(
        "synthetic",
        help="download the published seed-0 synthetic corpus instead of generating it",
        epilog="What it holds: bench/README.md#synthetic-corpus",
    )
    p.add_argument("out", type=Path, help="folder to write, such as bench/synthetic/")

    p = sub.add_parser(
        "synth",
        help="generate the synthetic corpus: clips with exact truth, and beat-known music",
        epilog="Contents, formats and run time: bench/README.md#synthetic-corpus",
    )
    p.add_argument("out", type=Path, help="folder to write, such as bench/synthetic/")
    p.add_argument(
        "--seed", type=int, default=0, help="the same seed gives the same corpus (default: 0)"
    )

    p = sub.add_parser("report", help="score every run in a corpus folder")
    p.add_argument("corpus", type=Path, help="folder of <clip>/truth and <clip>/runs/<run>")
    p.add_argument(
        "--tolerance",
        type=float,
        default=0.1,
        help="shot tolerance in seconds (default: %(default)s)",
    )

    p = sub.add_parser(
        "review", help="serve edits to rate blind: each alone, or two versions side by side"
    )
    p.add_argument(
        "round", type=Path, help="folder of <item>/<version>.mp4 edits; ratings go to ratings.jsonl"
    )
    p.add_argument("--rater", required=True, help="who is rating; saved with each rating")
    p.add_argument(
        "--seed", type=int, help="shuffle seed (default: a random one, saved with each rating)"
    )
    p.add_argument("--port", type=int, default=0, help="loopback port (default: a free one)")

    p = sub.add_parser(
        "review-report", help="mean scores, and preference rates for pairs, as Markdown"
    )
    p.add_argument("round", type=Path, help="round folder holding ratings.jsonl")
    return parser


def report(corpus: Path, tolerance: float) -> dict:
    """Score corpus/<clip>/runs/<run>/ against corpus/<clip>/truth/, pooled per run name.

    A run lacking an output its clip has truth for is listed under `missing`, and one that fails
    to score under `errors`, so pooled numbers from different clip subsets are never hidden.
    """
    if not corpus.is_dir():
        raise FileNotFoundError(f"{corpus}: no such folder")
    clips = sorted(p for p in corpus.iterdir() if (p / "truth").is_dir())
    if not clips:
        raise ValueError(f"{corpus}: no clips with truth/ folders")
    pooled: dict[str, dict[str, list]] = {}
    for clip in clips:
        truth = clip / "truth"
        ref_transcript = _first(truth, TRANSCRIPT_NAMES)
        ref_shots = truth / "shots.json"
        ref_speakers = truth / "speakers.json"
        for run in sorted(p for p in (clip / "runs").glob("*") if p.is_dir()):
            totals = pooled.setdefault(run.name, {k: [] for k in RESULT_KEYS})
            totals["clips"].append(clip.name)
            hyp, media = _first(run, TRANSCRIPT_NAMES), _first(run, MEDIA_NAMES)
            if ref_transcript and hyp:
                _add(totals, clip.name, "transcript", _transcript, ref_transcript, hyp)
            elif ref_transcript:
                totals["missing"].append(f"{clip.name}/transcript")
            if ref_shots.exists() and (run / "shots.json").exists():
                _add(totals, clip.name, "shots", _shots, ref_shots, run / "shots.json", tolerance)
            elif ref_shots.exists():
                totals["missing"].append(f"{clip.name}/shots")
            if ref_speakers.exists() and (run / "speakers.json").exists():
                _add(totals, clip.name, "speakers", _speakers, ref_speakers, run / "speakers.json")
            elif ref_speakers.exists():
                totals["missing"].append(f"{clip.name}/speakers")
            # A render has no truth to compare with, so a run without one is not missing anything.
            voice = run / "voice.wav" if (run / "voice.wav").exists() else None
            if media and (run / "edit_cuts.json").exists():
                _add(totals, clip.name, "render", _render, media, run / "edit_cuts.json", voice)
            if voice and (run / "music.wav").exists():
                project = run / "project.json"
                joins = mix.joins(project) if project.exists() else []
                _add(totals, clip.name, "mix", mix.check, voice, run / "music.wav", joins)
            # An edit of a group lives with its first clip and is scored against every clip
            # it uses, so the others have nothing missing either.
            if (run / "project.json").exists():
                _add(totals, clip.name, "edit", edit.score, run / "project.json")

    return {
        name: {
            "clips": s["clips"],
            "transcript": transcript.summarize(s["transcript"]) if s["transcript"] else None,
            "shots": shots.summarize(s["shots"]) if s["shots"] else None,
            "speakers": speakers.summarize(s["speakers"]) if s["speakers"] else None,
            "render": render.summarize(s["render"]) if s["render"] else None,
            "mix": mix.summarize(s["mix"]) if s["mix"] else None,
            "edit": edit.summarize(s["edit"]) if s["edit"] else None,
            "missing": s["missing"],
            "errors": s["errors"],
        }
        for name, s in pooled.items()
    }


def _add(totals: dict, clip: str, kind: str, compute, *args) -> None:
    try:
        totals[kind].append(compute(*args))
    # One unreadable output must not hide every other run's scores.
    except Exception as exc:
        totals["errors"].append(f"{clip}/{kind}: {exc}")


def _transcript(ref: Path, hyp: Path) -> transcript.Comparison:
    return transcript.compare(transcript.load(ref), transcript.load(hyp))


def _shots(ref: Path, hyp: Path, tolerance: float) -> dict:
    return shots.compare(shots.load_truth(ref), shots.load_cuts(hyp), tolerance)


def _speakers(ref: Path, hyp: Path) -> dict:
    return speakers.compare(speakers.load(ref), speakers.load(hyp))


def _render(media: Path, cuts: Path, voice: Path | None) -> dict:
    return render.check(media, shots.load_cuts(cuts), voice)


def _first(directory: Path, names: tuple[str, ...]) -> Path | None:
    return next((directory / n for n in names if (directory / n).exists()), None)
