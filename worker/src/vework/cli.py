import argparse
import json
import sys
from importlib.metadata import version
from pathlib import Path

import av

from vework import correct, index, music, transcribe, truth


def main(argv: list[str] | None = None) -> None:
    """Run one vework command. Progress goes to stderr; failures exit with 1."""
    parser = _parser()
    args = parser.parse_args(argv)
    if args.command == "analyze":
        if (args.title or args.batch) and not args.correct:
            parser.error("--title and --batch need --correct")
        if args.glossary and not (args.correct or args.asr_context):
            parser.error("--glossary needs --correct or --asr-context")
        if args.asr_context and not args.glossary:
            parser.error("--asr-context needs --glossary")
    try:
        if args.command == "draft-truth":
            _draft_truth(args)
        elif args.command == "analyze-music":
            _analyze_music(args)
        else:
            _analyze(args)
    except (OSError, ValueError, RuntimeError, av.error.FFmpegError) as exc:
        print(f"vework: error: {exc}", file=sys.stderr)
        sys.exit(1)


def _progress(message: str) -> None:
    print(f"vework: {message}", file=sys.stderr)


def _analyze(args: argparse.Namespace) -> None:
    # Check where results go before an analysis that can take hours.
    problem = _unwritable(args.output, args.bench_run)
    if _stem(args.output).resolve() == args.source.resolve():
        problem = f"{args.source}: the denoised speech would overwrite it; name the index otherwise"
    if problem:
        raise ValueError(problem)
    glossary = correct.read_glossary(args.glossary) if args.glossary else ()
    correction = None
    if args.correct:
        correct.require_credentials()
        correction = correct.Settings(args.title or args.source.stem, glossary, args.batch)
    context = "\n".join(glossary) if args.asr_context else ""
    result = index.build(
        args.source, args.asr_model, _progress, context, correction, _stem(args.output)
    )
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    if args.bench_run:
        args.bench_run.mkdir(parents=True, exist_ok=True)
        # vebench scores one time per transition: a hard cut's time, a dissolve's midpoint.
        cuts = [(t["start"] + t["end"]) / 2 for t in result["transitions"]]
        (args.bench_run / "shots.json").write_text(json.dumps({"cuts": cuts}) + "\n")
        words = {"words": result["transcript"]["words"]}
        (args.bench_run / "transcript.json").write_text(
            json.dumps(words, ensure_ascii=False) + "\n"
        )
        # vebench maps each face to the truth speaker it overlaps most, so faces need not be
        # matched across shots.
        turns = [
            {"start": s["start"], "end": s["end"], "speaker": f"face-{s['face']}"}
            for shot in result.get("framing", {"shots": []})["shots"]
            for s in shot["speakers"]
        ]
        (args.bench_run / "speakers.json").write_text(json.dumps({"turns": turns}) + "\n")


def _analyze_music(args: argparse.Namespace) -> None:
    problem = _unwritable(args.output, None)
    if problem:
        raise ValueError(problem)
    license = {"name": args.license}
    if args.license_url:
        license["url"] = args.license_url
    if args.attribution:
        license["attribution"] = args.attribution
    result = music.analyze(args.track, license, _progress)
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")


def _draft_truth(args: argparse.Namespace) -> None:
    source = truth.find_source(args.clip)
    # The truth may already hold hours of hand corrections.
    kept = truth.existing_transcript(args.clip)
    if kept and kept.name != "transcript.json":
        # vebench reads transcript.json first: a draft beside this file would replace it as truth.
        raise ValueError(f"{kept} is the clip's truth; move it away to draft a new transcript")
    if kept and not args.force:
        raise ValueError(f"{kept} exists and may hold corrections; pass --force to overwrite it")
    (args.clip / "truth").mkdir(exist_ok=True)
    draft = truth.draft_transcript(source, args.asr_model, _progress)
    (args.clip / "truth" / "transcript.json").write_text(
        json.dumps(draft, indent=2, ensure_ascii=False) + "\n"
    )


def _stem(output: Path) -> Path:
    """Where the denoised speech goes: beside the index, `talk.voice.wav` for `talk.index.json`."""
    name = output.name.removesuffix(".json").removesuffix(".index")
    return output.with_name(f"{name}.voice.wav")


def _unwritable(output: Path, bench_run: Path | None) -> str | None:
    if not output.parent.is_dir():
        return f"{output.parent}: no such folder for the output"
    if bench_run is not None and bench_run.exists() and not bench_run.is_dir():
        return f"{bench_run}: exists and is not a folder"
    return None


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="vework",
        description="Analyze footage into a media index for automatic editing.",
        epilog="Media index format: packages/schema/media-index.schema.json",
    )
    parser.add_argument("--version", action="version", version=f"vework {version('vework')}")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser(
        "analyze",
        help="write the media index of one source file: shots, speech, transcript, loudness, "
        "laughter, applause and music, faces and who speaks, and voice measurements, with the "
        "speech denoised beside it",
    )
    p.add_argument("source", type=Path, help="video or audio file")
    p.add_argument(
        "-o",
        "--output",
        type=Path,
        required=True,
        help="media index to write (JSON); the denoised speech goes beside it as <name>.voice.wav",
    )
    p.add_argument(
        "--asr-model",
        help=f"speech model (default: {transcribe.GPU_ASR_MODEL} with a CUDA GPU, "
        f"{transcribe.CPU_ASR_MODEL} otherwise)",
    )
    p.add_argument("--bench-run", type=Path, help="also write vebench outputs to this folder")
    p.add_argument(
        "--correct",
        action="store_true",
        help=f"have Claude ({correct.MODEL}) fix misheard words before they are timed; sends the "
        "transcript text, the title and the glossary (never audio or video) to Anthropic and "
        "needs ANTHROPIC_API_KEY",
    )
    p.add_argument(
        "--title",
        help="video title Claude reads as context (default: the file name without its extension)",
    )
    p.add_argument(
        "--glossary",
        type=Path,
        help="names and terms said in the footage, one per line, for --correct and --asr-context",
    )
    p.add_argument(
        "--asr-context",
        action="store_true",
        help="also give the glossary to the speech model, which biases it towards those words",
    )
    p.add_argument(
        "--batch",
        action="store_true",
        help="send the corrections as one Message Batch: half the price, but it can take up to "
        "24 hours; for runs nobody waits on",
    )

    p = sub.add_parser(
        "analyze-music",
        help="write the music index of one track: tempo, beats, downbeats, sections, loudness "
        "and the licence it is used under",
        epilog="Use only music you have the right to use: your own, or a library's whose licence "
        "allows it. Music index format: packages/schema/music-index.schema.json",
    )
    p.add_argument("track", type=Path, help="audio file")
    p.add_argument("-o", "--output", type=Path, required=True, help="music index to write (JSON)")
    p.add_argument(
        "--license",
        required=True,
        help="the licence the track is used under, e.g. 'CC BY 4.0'; recorded in the index, the "
        "project and next to every output that plays it",
    )
    p.add_argument("--license-url", help="where the licence or the track's terms are published")
    p.add_argument("--attribution", help="the credit line the licence asks for")

    p = sub.add_parser(
        "draft-truth",
        help="draft a corpus clip's truth/transcript.json for a person to correct",
        epilog="Correction workflow: bench/README.md#ground-truth",
    )
    p.add_argument("clip", type=Path, help="corpus clip folder holding source.<ext>")
    p.add_argument(
        "--asr-model",
        default=transcribe.GPU_ASR_MODEL,
        help="speech model (default: %(default)s, the most accurate, even without a GPU)",
    )
    p.add_argument(
        "--force", action="store_true", help="overwrite an existing truth/transcript.json"
    )
    return parser
