import http.client
import json
import threading
import urllib.error
import urllib.request
from contextlib import contextmanager

import pytest
from conftest import ffmpeg

from vebench import review
from vebench.cli import main

VERSIONS = {
    "talk-60s": ("after-fix", "before-fix", "preset-bold"),
    "talk-5min": ("after-fix", "before-fix"),
    "phone-30s": ("release-1",),
}


@pytest.fixture(scope="module")
def round_dir(tmp_path_factory):
    """Three versions of one edit, two of another and one edit alone: four pairs and a single."""
    root = tmp_path_factory.mktemp("round-1")
    for i, (item, versions) in enumerate(VERSIONS.items()):
        (root / item).mkdir()
        for j, version in enumerate(versions):
            # A distinct tone per edit, so the served bytes say which file was sent.
            ffmpeg("-f", "lavfi", "-i", "testsrc2=s=64x64:r=10:d=0.5",
                   "-f", "lavfi", "-i", f"sine=f={200 + 100 * i + 10 * j}:d=0.5",
                   "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest",
                   str(root / item / f"{version}.mp4"))  # fmt: skip
    (root / "no-edit").mkdir()
    return root


@pytest.fixture
def fresh_round(round_dir, tmp_path):
    """The shared edits in a folder of their own, so each test starts with no ratings."""
    for item in VERSIONS:
        (tmp_path / item).mkdir()
        for version in VERSIONS[item]:
            (tmp_path / item / f"{version}.mp4").symlink_to(round_dir / item / f"{version}.mp4")
    return tmp_path


@contextmanager
def serving(round_dir, rater="owner", seed=7):
    with review.Server(review.Session(round_dir, rater, seed)) as server:
        # A short poll keeps shutdown, and so each test, fast.
        thread = threading.Thread(target=server.serve_forever, args=(0.01,))
        thread.start()
        try:
            yield server.url
        finally:
            server.shutdown()
            thread.join()


def get(url, headers=None):
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers or {})) as r:
        return r.status, dict(r.headers), r.read()


def session(url):
    return json.loads(get(url + "api/state")[2])["session"]


def post(url, body):
    """Send a rating as the page does, with this run's session unless the body names one."""
    if isinstance(body, dict):
        body = {"session": session(url), **body}
    request = urllib.request.Request(
        url + "api/ratings",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def scores(value):
    return {k: value for k in review.CATEGORIES}


def first(round_dir, size, seed=7):
    """The index of the first task showing `size` edits in the shuffle `seed` gives."""
    tasks = review.Session(round_dir, "nobody", seed).tasks
    return next(i for i, t in enumerate(tasks) if len(t.versions) == size)


def test_one_edit_is_rated_alone_and_versions_of_one_edit_in_pairs(round_dir):
    tasks = review.shuffle_tasks(review.find_edits(round_dir), seed=1)
    assert sorted((t.item, *sorted(t.versions)) for t in tasks) == [
        ("phone-30s", "release-1"),
        ("talk-5min", "after-fix", "before-fix"),
        ("talk-60s", "after-fix", "before-fix"),
        ("talk-60s", "after-fix", "preset-bold"),
        ("talk-60s", "before-fix", "preset-bold"),
    ]


def test_the_seed_fixes_order_and_sides_and_seeds_differ(round_dir):
    items = review.find_edits(round_dir)
    assert review.shuffle_tasks(items, 1) == review.shuffle_tasks(items, 1)
    orders = {tuple(review.shuffle_tasks(items, seed)) for seed in range(20)}
    assert len(orders) > 1
    # Each version shows up on both sides across seeds, so position cannot give it away.
    sides = {
        (v, side)
        for seed in range(20)
        for t in review.shuffle_tasks(items, seed)
        if len(t.versions) == 2
        for v, side in zip(t.versions, "ab", strict=True)
    }
    assert sides == {(v, side) for v in VERSIONS["talk-60s"] for side in "ab"}


def test_a_round_without_an_edit_is_an_error(tmp_path):
    (tmp_path / "x").mkdir()
    with pytest.raises(ValueError, match="no <item>/<version>.mp4"):
        review.find_edits(tmp_path)


def test_the_page_and_api_never_name_a_version_or_item(fresh_round):
    with serving(fresh_round) as url:
        state = json.loads(get(url + "api/state")[2])
        exposed = b"".join(get(url + p)[2] for p in ("", "review.js", "review.css", "api/state"))
    assert state["total"] == 5 and state["rated"] == 0 and state["task"] == 0
    for name in ("after-fix", "before-fix", "preset-bold", "release-1", *VERSIONS):
        assert name.encode() not in exposed


def test_media_supports_ranges_for_seeking(fresh_round):
    single, pair = first(fresh_round, 1), first(fresh_round, 2)
    whole = review.Session(fresh_round, "owner", 7).media(pair, "a").read_bytes()
    with serving(fresh_round) as url:
        media = url + f"media/{session(url)}/"
        status, headers, body = get(media + f"{pair}/a", {"Range": "bytes=10-19"})
        assert status == 206 and body == whole[10:20]
        assert headers["Content-Range"] == f"bytes 10-19/{len(whole)}"
        assert get(media + f"{pair}/a", {"Range": "bytes=-5"})[2] == whole[-5:]
        status, headers, body = get(media + f"{pair}/a")
        assert status == 200 and body == whole and headers["Accept-Ranges"] == "bytes"
        with pytest.raises(urllib.error.HTTPError) as e:
            get(media + f"{pair}/a", {"Range": f"bytes={len(whole)}-"})
        assert e.value.code == 416
        # An edit rated alone has no Edit B, and the round has five tasks.
        for missing in (f"{single}/b", "5/a"):
            with pytest.raises(urllib.error.HTTPError) as e:
                get(media + missing)
            assert e.value.code == 404


def test_a_scripted_session_records_every_task_under_version_names(fresh_round):
    files = {
        path.read_bytes(): version
        for edits in review.find_edits(fresh_round).values()
        for version, path in edits.items()
    }
    shown = []
    with serving(fresh_round, rater="owner", seed=42) as url:
        while (state := json.loads(get(url + "api/state")[2]))["task"] is not None:
            task, sides = state["task"], state["sides"]
            shown.append(
                [files[get(url + f"media/{state['session']}/{task}/{s}")[2]] for s in sides]
            )
            # The rater scores A at 4 and B at 2, and prefers A; an edit alone gets no question.
            body = {"task": task, "scores": dict(zip(sides, (scores(4), scores(2)), strict=False))}
            if len(sides) == 2:
                body["preferred"] = "a"
            status, reply = post(url, body)
            assert status == 200 and reply["rated"] == len(shown)
    assert sorted(len(s) for s in shown) == [1, 2, 2, 2, 2]
    records = review.load_ratings(fresh_round / "ratings.jsonl")
    assert [r["versions"] for r in records] == shown
    for r in records:
        assert r["rater"] == "owner" and r["seed"] == 42
        if len(r["versions"]) == 1:
            assert r["scores"] == {"release-1": scores(4)} and "preferred" not in r
        else:
            a, b = r["versions"]
            assert r["scores"] == {a: scores(4), b: scores(2)} and r["preferred"] == a


@pytest.mark.parametrize(
    "size, body, message",
    [
        (2, {"scores": {"a": scores(4)}, "preferred": "a"}, "scores must be given"),
        (2, {"scores": {"a": scores(4), "b": scores(6)}, "preferred": "a"}, "1 to 5"),
        (2, {"scores": {"a": scores(4), "b": scores(True)}, "preferred": None}, "1 to 5"),
        (2, {"scores": {"a": scores(4), "b": {"story": 3}}, "preferred": "a"}, "cover"),
        (2, {"scores": {"a": scores(4), "b": scores(4)}, "preferred": "c"}, "preferred"),
        (2, {"scores": {"a": scores(4), "b": scores(4)}}, "preferred is missing"),
        (1, {"scores": {"a": scores(4), "b": scores(4)}}, "scores must be given for a"),
        (1, {"scores": {"a": scores(4)}, "preferred": "a"}, "rated alone"),
        (None, {"scores": {"a": scores(4)}}, "task is missing"),
        (None, {"task": 9, "scores": {"a": scores(4)}}, "task must"),
        (None, [], "JSON object"),
    ],
)
def test_an_incomplete_rating_is_refused_and_not_saved(fresh_round, size, body, message):
    if size:
        body = {"task": first(fresh_round, size), **body}
    with serving(fresh_round) as url:
        status, reply = post(url, body)
    assert status == 400 and message in reply["error"]
    assert not (fresh_round / "ratings.jsonl").exists()


def test_a_task_is_rated_once(fresh_round):
    body = {"task": first(fresh_round, 1), "scores": {"a": scores(3)}}
    with serving(fresh_round) as url:
        assert post(url, body)[0] == 200
        status, reply = post(url, body)
    assert status == 400 and "already rated" in reply["error"]


def test_a_page_from_an_earlier_run_cannot_save_or_play(fresh_round):
    # Each run shuffles anew, so the old page's task number now means other edits.
    with serving(fresh_round, seed=1) as url:
        old = json.loads(get(url + "api/state")[2])
    with serving(fresh_round, seed=2) as url:
        stale = {"session": old["session"], "task": old["task"], "preferred": "a"}
        status, reply = post(url, stale | {"scores": {"a": scores(4), "b": scores(2)}})
        with pytest.raises(urllib.error.HTTPError) as e:
            get(url + f"media/{old['session']}/0/a")
    assert status == 409 and "restarted" in reply["error"]
    assert e.value.code == 409
    assert not (fresh_round / "ratings.jsonl").exists()


def test_requests_from_another_site_are_refused(fresh_round):
    with serving(fresh_round) as url:
        host, port = url.removeprefix("http://").rstrip("/").split(":")
        conn = http.client.HTTPConnection(host, int(port))
        conn.request(
            "GET", f"/media/{session(url)}/0/a", headers={"Host": f"attacker.example:{port}"}
        )
        assert conn.getresponse().status == 403
        conn.close()
        request = urllib.request.Request(url + "api/ratings", data=b"{}",
                                         headers={"Content-Type": "text/plain"})  # fmt: skip
        with pytest.raises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(request)
        assert e.value.code == 415


def test_a_resumed_session_skips_what_this_rater_already_rated(fresh_round):
    with serving(fresh_round, seed=3) as url:
        post(url, {"task": first(fresh_round, 1, seed=3), "scores": {"a": scores(5)}})
        pair = first(fresh_round, 2, seed=3)
        post(url, {"task": pair, "scores": {"a": scores(5), "b": scores(1)}, "preferred": "a"})
    again = review.Session(fresh_round, "owner", 11)
    assert again.state()["rated"] == 2
    assert review.Session(fresh_round, "guest", 11).state()["rated"] == 0


def alone(rater, item, version, score):
    return {"rater": rater, "item": item, "versions": [version], "scores": {version: scores(score)}}


def pair(rater, item, a, b, a_score, b_score, preferred):
    return {"rater": rater, "item": item, "versions": [a, b], "preferred": preferred,
            "scores": {a: scores(a_score), b: scores(b_score)}}  # fmt: skip


def test_summary_gives_means_alone_and_preference_rates_in_pairs():
    single, both = review.summarize(
        [
            alone("owner", "x", "main", 5),
            alone("owner", "y", "main", 4),
            alone("guest", "x", "main", 4),
            pair("owner", "x", "after", "before", 5, 3, "after"),
            pair("owner", "y", "before", "after", 2, 4, "after"),
            pair("guest", "x", "after", "before", 3, 3, None),
            pair("guest", "y", "after", "before", 2, 4, "before"),
        ]
    )
    assert single == {
        "versions": ["main"],
        "ratings": 3,
        "items": 2,
        "raters": 2,
        "means": {"main": scores(13 / 3)},
    }
    assert both["versions"] == ["after", "before"]
    assert both["ratings"] == 4 and both["items"] == 2 and both["raters"] == 2
    assert both["preferred"] == {"after": 2, "before": 1} and both["no_preference"] == 1
    # No preference counts as half for each, so the two rates sum to 1.
    assert both["preference_rate"] == {"after": 0.625, "before": 0.375}
    assert both["means"]["after"]["overall"] == 3.5
    assert both["means"]["before"]["story"] == 3.0


def test_review_report_prints_markdown_for_edits_alone_and_pairs(capsys, tmp_path):
    lines = [
        alone("owner", "x", "main", 5),
        alone("owner", "y", "main", 4),
        pair("owner", "x", "after", "before", 5, 3, "after"),
        pair("owner", "y", "before", "after", 2, 4, "after"),
    ]
    (tmp_path / "ratings.jsonl").write_text("".join(json.dumps(r) + "\n" for r in lines))
    main(["review-report", str(tmp_path)])
    out = capsys.readouterr().out
    assert "### Rated alone" in out
    assert "| Overall: would post this | 4.50 |" in out
    assert "| **Ratings** | 2 |" in out
    assert "### after vs before" in out
    assert "| Overall: would post this | 4.50 | 2.50 |" in out
    assert "| **Preference rate** | 100% | 0% |" in out


def test_review_report_without_ratings_is_a_one_line_error(capsys, tmp_path):
    with pytest.raises(SystemExit) as exit_info:
        main(["review-report", str(tmp_path)])
    assert exit_info.value.code == 1
    assert "no ratings yet" in capsys.readouterr().err


@pytest.mark.parametrize(
    "line, message",
    [
        ("{not json", "Expecting property name"),
        (json.dumps(alone("owner", "x", "main", 4) | {"preferred": None}), "rated alone"),
        (json.dumps(pair("owner", "x", "v1", "v1", 4, 4, None)), "versions must"),
        (json.dumps(alone("owner", "x", "main", 4) | {"versions": []}), "versions must"),
    ],
)
def test_a_damaged_ratings_line_names_its_line(tmp_path, line, message):
    good = pair("owner", "x", "after", "before", 5, 3, "after")
    (tmp_path / "ratings.jsonl").write_text(json.dumps(good) + "\n" + line + "\n")
    with pytest.raises(ValueError) as e:
        review.load_ratings(tmp_path / "ratings.jsonl")
    assert str(e.value).startswith("ratings.jsonl line 2: ") and message in str(e.value)
