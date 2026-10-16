"""Blind review of our edits: people rate an edit alone, or two versions of it side by side.

A round is a folder of `<item>/<version>.mp4` edits, one item per footage and target length.
"""

import itertools
import json
import os
import random
import re
import secrets
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.resources import files
from pathlib import Path
from statistics import fmean
from urllib.parse import urlsplit

CATEGORIES = {
    "story": "Story and pacing",
    "cuts": "Cut quality",
    "captions": "Caption accuracy and look",
    "framing": "Framing",
    "audio": "Audio",
    "effects": "Effects",
    "overall": "Overall: would post this",
}
RATINGS = "ratings.jsonl"
# The page only ever sees these neutral labels; which version sits behind each stays server-side.
SIDES = ("a", "b")
PAGE = files("vebench") / "review_page"
STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/review.css": ("review.css", "text/css; charset=utf-8"),
    "/review.js": ("review.js", "text/javascript; charset=utf-8"),
}
MAX_BODY = 64 * 1024
RESTARTED = "the review server restarted after this page loaded; reload the page"


@dataclass(frozen=True)
class Task:
    """One item's edit rated alone, or two of its versions; `versions` in the order shown."""

    item: str
    versions: tuple[str, ...]


class StalePage(Exception):
    """The page came from an earlier run, whose shuffle gave its task numbers to other edits."""


def find_edits(round_dir: Path) -> dict[str, dict[str, Path]]:
    """Map each item folder to its edits by version."""
    if not round_dir.is_dir():
        raise FileNotFoundError(f"{round_dir}: no such folder")
    items = {}
    for item in sorted(p for p in round_dir.iterdir() if p.is_dir()):
        if edits := {p.stem: p for p in sorted(item.glob("*.mp4"))}:
            items[item.name] = edits
    if not items:
        raise ValueError(f"{round_dir}: no <item>/<version>.mp4 edits")
    return items


def shuffle_tasks(items: dict[str, dict[str, Path]], seed: int) -> list[Task]:
    """An item's only edit alone, or every two of its versions; seeded order and sides."""
    rng = random.Random(seed)
    tasks = [
        (item, versions)
        for item, edits in items.items()
        for versions in (
            itertools.combinations(sorted(edits), 2) if len(edits) > 1 else [(*edits,)]
        )
    ]
    rng.shuffle(tasks)
    return [Task(item, tuple(rng.sample(versions, len(versions)))) for item, versions in tasks]


def check_rating(rating: dict, sides: tuple[str, ...]) -> None:
    """Raise ValueError unless every side has a 1-5 score for every category, and a pair a
    preference; an edit rated alone has no preference question."""
    scores = rating.get("scores")
    if not isinstance(scores, dict) or set(scores) != set(sides):
        raise ValueError(f"scores must be given for {' and '.join(sides)}")
    for side in sides:
        given = scores[side]
        if not isinstance(given, dict) or set(given) != set(CATEGORIES):
            raise ValueError(f"{side}: scores must cover {', '.join(CATEGORIES)}")
        if any(type(v) is not int or not 1 <= v <= 5 for v in given.values()):
            raise ValueError(f"{side}: scores must be whole numbers from 1 to 5")
    if len(sides) == 1:
        if "preferred" in rating:
            raise ValueError("an edit rated alone has no preference")
    elif "preferred" not in rating:
        raise ValueError("preferred is missing")
    elif rating["preferred"] not in (*sides, None):
        raise ValueError(f"preferred must be {' or '.join(sides)}, or null for no preference")


def load_ratings(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    records = []
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
            if not all(isinstance(record[k], str) for k in ("rater", "item")):
                raise ValueError("rater and item must be text")
            versions = record["versions"]
            if not (
                isinstance(versions, list)
                and len(versions) in (1, 2)
                and all(isinstance(v, str) for v in versions)
                and len(set(versions)) == len(versions)
            ):
                raise ValueError("versions must list one edit, or two different ones")
            check_rating(record, tuple(versions))
        except (ValueError, KeyError, TypeError) as exc:
            raise ValueError(f"{path.name} line {n}: {exc}") from None
        records.append(record)
    return records


class Session:
    """One rater's pass through a round. Tasks the rater already rated are skipped on resume."""

    def __init__(self, round_dir: Path, rater: str, seed: int):
        if not rater.strip():
            raise ValueError("--rater must name who is rating")
        self.items = find_edits(round_dir)
        self.path = round_dir / RATINGS
        self.rater, self.seed = rater, seed
        self.tasks = shuffle_tasks(self.items, seed)
        done = {
            _key(r["item"], r["versions"]) for r in load_ratings(self.path) if r["rater"] == rater
        }
        self.rated = [_key(t.item, t.versions) in done for t in self.tasks]
        self.lock = threading.Lock()
        # The page sends this back, so one left open across a restart cannot rate or play the
        # edits the new shuffle gave its task numbers to.
        self.token = secrets.token_urlsafe(8)

    def state(self) -> dict:
        """What the page needs to show the next task; nothing that could name a version."""
        task = next((i for i, done in enumerate(self.rated) if not done), None)
        return {
            "categories": [{"key": k, "label": v} for k, v in CATEGORIES.items()],
            "total": len(self.tasks),
            "rated": sum(self.rated),
            "task": task,
            "sides": [] if task is None else list(self._sides(task)),
            "session": self.token,
        }

    def media(self, index: int, side: str) -> Path | None:
        sides = self._sides(index)
        if side not in sides:
            return None
        task = self.tasks[index]
        return self.items[task.item][task.versions[sides.index(side)]]

    def record(self, body) -> dict:
        """Append one rating, translated from the page's sides to version names."""
        if not isinstance(body, dict):
            raise ValueError("the rating must be a JSON object")
        if body.get("session") != self.token:
            raise StalePage(RESTARTED)
        index = body.get("task")
        if index is None:
            raise ValueError("task is missing")
        if type(index) is not int or not 0 <= index < len(self.tasks):
            raise ValueError(f"task must be a number from 0 to {len(self.tasks) - 1}")
        sides, task = self._sides(index), self.tasks[index]
        check_rating(body, sides)
        names = dict(zip(sides, task.versions, strict=True))
        line = {
            "time": datetime.now(UTC).isoformat(timespec="seconds"),
            "rater": self.rater,
            "seed": self.seed,
            "item": task.item,
            "versions": list(task.versions),
            "scores": {names[s]: {k: body["scores"][s][k] for k in CATEGORIES} for s in sides},
        }
        if len(sides) == 2:
            line["preferred"] = names.get(body["preferred"])
        with self.lock:
            if self.rated[index]:
                raise ValueError("this is already rated; reload the page for the next one")
            with self.path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(line, ensure_ascii=False) + "\n")
                f.flush()
                os.fsync(f.fileno())
            self.rated[index] = True
        return self.state()

    def _sides(self, index: int) -> tuple[str, ...]:
        return SIDES[: len(self.tasks[index].versions)]


def _key(item: str, versions) -> tuple[str, frozenset[str]]:
    return item, frozenset(versions)


class Server(ThreadingHTTPServer):
    def __init__(self, session: Session, port: int = 0):
        # Loopback only: the footage never leaves this machine.
        super().__init__(("127.0.0.1", port), Handler)
        self.session = session

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server_address[1]}/"


class Handler(BaseHTTPRequestHandler):
    server: Server

    def log_message(self, format, *args) -> None:
        pass  # A video player sends many range requests; logging each would bury the URL.

    def do_GET(self) -> None:
        if not self._from_this_page():
            return
        path = urlsplit(self.path).path
        session = self.server.session
        if path in STATIC:
            name, content_type = STATIC[path]
            self._send(HTTPStatus.OK, content_type, (PAGE / name).read_bytes())
        elif path == "/api/state":
            self._json(HTTPStatus.OK, session.state())
        elif (m := re.fullmatch(r"/media/([\w-]+)/(\d+)/([ab])", path)) and m[1] != session.token:
            self._json(HTTPStatus.CONFLICT, {"error": RESTARTED})
        elif m and int(m[2]) < len(session.tasks) and (media := session.media(int(m[2]), m[3])):
            self._media(media)
        else:
            self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})

    def do_POST(self) -> None:
        if not self._from_this_page():
            return
        if urlsplit(self.path).path != "/api/ratings":
            self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        # A cross-site page cannot send application/json without a preflight this server refuses.
        if self.headers.get_content_type() != "application/json":
            self._json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"error": "send application/json"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if not 0 < length <= MAX_BODY:
                raise ValueError(f"the rating must be 1 to {MAX_BODY} bytes")
            state = self.server.session.record(json.loads(self.rfile.read(length)))
        except StalePage as exc:
            self._json(HTTPStatus.CONFLICT, {"error": str(exc)})
            return
        except ValueError as exc:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return
        self._json(HTTPStatus.OK, state)

    def _from_this_page(self) -> bool:
        # Checking Host stops DNS rebinding: another site resolving its name to 127.0.0.1
        # could otherwise read the footage through the visitor's browser.
        port = self.server.server_address[1]
        if self.headers.get("Host") in (f"127.0.0.1:{port}", f"localhost:{port}"):
            return True
        self._json(HTTPStatus.FORBIDDEN, {"error": "open the address vebench review printed"})
        return False

    def _media(self, path: Path) -> None:
        # Browsers seek in a video through range requests; without them the player cannot seek.
        size = path.stat().st_size
        start, end, status = 0, size - 1, HTTPStatus.OK
        m = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range", ""))
        if m and (m[1] or m[2]):
            if m[1]:
                start, end = int(m[1]), min(int(m[2]), end) if m[2] else end
            else:
                start = max(size - int(m[2]), 0)
            if start > end:
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            status = HTTPStatus.PARTIAL_CONTENT
        self.send_response(status)
        self.send_header("Content-Type", "video/mp4")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        if status == HTTPStatus.PARTIAL_CONTENT:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        with path.open("rb") as f:
            try:
                self.connection.sendfile(f, start, end - start + 1)
            except (BrokenPipeError, ConnectionResetError):
                pass  # The player dropped the request to seek elsewhere.

    def _json(self, status: HTTPStatus, body: dict) -> None:
        self._send(status, "application/json", json.dumps(body).encode())

    def _send(self, status: HTTPStatus, content_type: str, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def serve(round_dir: Path, rater: str, seed: int | None, port: int) -> None:
    """Serve the rating page until Ctrl+C."""
    seed = secrets.randbits(32) if seed is None else seed
    session = Session(round_dir, rater, seed)
    with Server(session, port) as server:
        state = session.state()
        alone = sum(len(t.versions) == 1 for t in session.tasks)
        print(
            f"{_count(alone, 'edit')} to rate alone and {_count(state['total'] - alone, 'pair')}; "
            f"{state['rated']} already rated by {rater}; seed {seed}"
        )
        print(f"Rate at {server.url}  (Ctrl+C stops)", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


def summarize(records: list[dict]) -> list[dict]:
    """Means for each version rated alone, then means and preferences for each two versions
    rated together."""
    groups: dict[tuple[str, ...], list[dict]] = {}
    for r in records:
        groups.setdefault(tuple(sorted(r["versions"])), []).append(r)
    results = []
    for versions, rs in sorted(groups.items(), key=lambda g: (len(g[0]), g[0])):
        result = {
            "versions": list(versions),
            "ratings": len(rs),
            "items": len({r["item"] for r in rs}),
            "raters": len({r["rater"] for r in rs}),
            "means": {
                v: {k: fmean(r["scores"][v][k] for r in rs) for k in CATEGORIES} for v in versions
            },
        }
        if len(versions) == 2:
            neither = sum(r["preferred"] is None for r in rs)
            preferred = {v: sum(r["preferred"] == v for r in rs) for v in versions}
            result |= {
                "preferred": preferred,
                "no_preference": neither,
                # No preference counts as half for each, so the two rates sum to 1.
                "preference_rate": {v: (preferred[v] + neither / 2) / len(rs) for v in versions},
            }
        results.append(result)
    return results


def report(round_dir: Path) -> str:
    """The round's results as Markdown, ready to post on the roadmap issue."""
    records = load_ratings(round_dir / RATINGS)
    if not records:
        raise ValueError(f"{round_dir / RATINGS}: no ratings yet; run vebench review first")
    raters = len({r["rater"] for r in records})
    results = summarize(records)
    alone = [r for r in results if len(r["versions"]) == 1]
    pairs = [r for r in results if len(r["versions"]) == 2]
    lines = [
        f"## Blind review: {round_dir.resolve().name}",
        "",
        f"{_count(len(records), 'rating')} by {_count(raters, 'rater')}. Scores are means on a "
        "1–5 scale."
        + (" The preference rate counts no preference as half for each." if pairs else ""),
    ]
    if alone:
        means = {v: r["means"][v] for r in alone for v in r["versions"]}
        lines += [
            "",
            "### Rated alone",
            "",
            "| | " + " | ".join(means) + " |",
            "|---|" + "--:|" * len(means),
            *(
                f"| {label} | " + " | ".join(f"{m[k]:.2f}" for m in means.values()) + " |"
                for k, label in CATEGORIES.items()
            ),
            "| **Ratings** | " + " | ".join(str(r["ratings"]) for r in alone) + " |",
        ]
    for r in pairs:
        x, y = r["versions"]
        lines += [
            "",
            f"### {x} vs {y}",
            "",
            f"{_count(r['ratings'], 'rating')} of {_count(r['items'], 'item')} by "
            f"{_count(r['raters'], 'rater')}. No preference: {r['no_preference']}.",
            "",
            f"| | {x} | {y} |",
            "|---|--:|--:|",
            *(
                f"| {label} | {r['means'][x][k]:.2f} | {r['means'][y][k]:.2f} |"
                for k, label in CATEGORIES.items()
            ),
            f"| **Preferred** | {r['preferred'][x]} | {r['preferred'][y]} |",
            f"| **Preference rate** | {r['preference_rate'][x]:.0%} | "
            f"{r['preference_rate'][y]:.0%} |",
        ]
    return "\n".join(lines) + "\n"


def _count(n: int, noun: str) -> str:
    return f"{n} {noun}{'s' * (n != 1)}"
