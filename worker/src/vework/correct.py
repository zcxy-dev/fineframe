"""Fix what the speech model misheard with Claude, before the aligner times the words.

Claude reads each transcribed chunk with its neighbours, the video's title and the user's
glossary, and proposes edits with a reason each. vework applies only the edits that keep every
spoken word in place (`check`) and records every proposal, applied or not, in the media index.
"""

import json
import math
import re
import time
import unicodedata
from collections import Counter
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import anthropic

from vework.transcribe import to_traditional

MODEL = "claude-sonnet-5-5"
# Weighing a few words against their context is short work; to be swept on a hand-checked corpus.
EFFORT = "medium"
MAX_TOKENS = 16_000  # thinking counts against it; the reply itself is a few hundred tokens
CONTEXT = 2  # neighbouring chunks sent on each side
WORKERS = 8  # chunks corrected at once outside a batch
POLL_SECONDS = 30
# The prompt and the Taiwan Traditional conversion fit these; other chunks stay as transcribed.
LANGUAGES = ("Chinese", "English")
# Fixing misheard words changes a few words per chunk; more than this is a rewrite.
MIN_BUDGET = 4
BUDGET_SHARE = 0.2

ADDS = "adds words that were not transcribed"
REMOVES = "removes transcribed words"
SCRIPT = "writes words in another script"
# English hesitations; the editor cuts them by their timings, so no merge may swallow one.
FILLERS = frozenset({"ah", "eh", "er", "erm", "hm", "hmm", "mm", "uh", "uhm", "um"})

SYSTEM = """\
You fix speech-recognition errors in a video's transcript before its words are timed for \
captions.

The transcript comes from a speech model and was converted to Taiwan Traditional Chinese. \
Speakers mix Mandarin and English, often inside one sentence. The model mishears in predictable \
ways: Chinese homophones and near-homophones (在/再, 的/得), names and specialist terms heard as \
common words, and English words heard as other English words. You get one chunk of the \
transcript at a time, with the chunks around it, the video's title and the user's glossary of \
names and terms that occur in the video. Use them as evidence of what was said.

What to change
- Only words the speech model evidently misheard: the transcribed word makes no sense where it \
stands, and a word that sounds the same or nearly the same fits the context, the title or the \
glossary.
- When you are not sure, leave the text as it is. A wrong correction costs more than a missed \
one.

What never to change
- Never add words and never remove words. Fillers (嗯, 呃, 那個, um, uh), repeated words, false \
starts and sentences the speaker restarts stay exactly as transcribed: the editor finds and cuts \
them by their timings.
- Never rephrase, translate, summarize or fix the speaker's grammar or word choice. Mistakes the \
speaker made are part of what was said.
- Keep every word in the script it was transcribed in. Chinese stays in Taiwan Traditional \
Chinese characters, one character per spoken syllable, so a misheard character is replaced by \
exactly one other character. English stays English. Do not turn English into Chinese or Chinese \
into English, even when you suspect the speaker said the other.
- Keep the punctuation unless the corrected words need different punctuation.

Each change you return
- original: copied exactly from the chunk, character for character, spaces and punctuation \
included, with enough of the surrounding text that it occurs only once in the chunk.
- corrected: the same text with the misheard words fixed.
- reason: one short English sentence naming the misheard word and the evidence for the fix.
Return no changes when the chunk needs none; that is the usual case.

Examples

Chunk: 我們在來看下一個例子。
Change: original "我們在來看", corrected "我們再來看", reason "在 should be its homophone 再 \
(again)."

Glossary: Kubernetes. Chunk: 我們把服務部署到 cooper netties 上面。
Change: original "cooper netties", corrected "Kubernetes", reason "The glossary term Kubernetes, \
heard as two English words."

Glossary: 林佳穎. Chunk: 今天的來賓是林家穎。
Change: original "林家穎", corrected "林佳穎", reason "The glossary name 林佳穎; 家 and 佳 sound \
alike."

Chunk: 嗯，那個，我們我們先看一下 the the result。
No changes: the fillers and the repeated words were spoken."""

SCHEMA = {
    "type": "object",
    "properties": {
        "changes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "original": {"type": "string"},
                    "corrected": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["original", "corrected", "reason"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["changes"],
    "additionalProperties": False,
}

# The tokens vebench scores (bench/src/vebench/transcript.py), so the guard counts words the
# way the error rate does: one per CJK character, one per other run of letters or digits.
_CJK = "〇぀-ヺー-ヿ㄀-ㄯㆠ-ㆿ㐀-䶿一-鿿豈-﫿가-힯\U00020000-\U0003134f"
_TOKEN = re.compile(rf"([{_CJK}])|([^\W_{_CJK}]+(?:'[^\W_{_CJK}]+)*)")


@dataclass(frozen=True)
class Settings:
    """What `vework analyze --correct` sends with each chunk, and how."""

    title: str
    glossary: tuple[str, ...] = ()
    batch: bool = False


def read_glossary(path: Path) -> tuple[str, ...]:
    """One name or term per line; blank lines and lines starting with # are skipped."""
    lines = (line.strip() for line in path.read_text(encoding="utf-8").splitlines())
    return tuple(line for line in lines if line and not line.startswith("#"))


def require_credentials() -> None:
    """Fail before an analysis that takes hours when Claude cannot be called at its end."""
    try:
        # A profile named by ANTHROPIC_PROFILE that cannot be read fails here.
        client = _client()
        if not (client.api_key or client.auth_token or client.credentials):
            raise RuntimeError(
                "--correct needs an Anthropic API key: set ANTHROPIC_API_KEY, or load the "
                "repository's .env with `uv run --env-file ../.env vework ...`"
            )
        client.models.retrieve(MODEL)
    except anthropic.AnthropicError as exc:
        raise RuntimeError(f"cannot use {MODEL} for --correct: {exc}") from exc


def correct(
    chunks: list[dict], settings: Settings, progress: Callable[[str], None] = lambda message: None
) -> tuple[list[str], list[dict]]:
    """Each chunk's text with the accepted corrections, and every change Claude proposed.

    `chunks` hold "start", "end", "text" and the speech model's "language", in time order.
    Only Chinese and English chunks are corrected; all of them serve as context.
    """
    texts = [chunk["text"] for chunk in chunks]
    todo = [i for i, chunk in enumerate(chunks) if chunk["language"] in LANGUAGES]
    if not todo:
        return texts, []
    requests = {f"chunk-{i}": _request(chunks, i, settings) for i in todo}
    how = " in a Message Batch" if settings.batch else ""
    progress(f"correcting {len(todo)} chunks with {MODEL}{how}")
    try:
        client = _client()
        replies = _batch(client, requests, progress) if settings.batch else _now(client, requests)
    except anthropic.AnthropicError as exc:
        raise RuntimeError(f"transcript correction failed: {exc}") from exc

    records = []
    for i in todo:
        chunk = chunks[i]
        reply = _changes(replies[f"chunk-{i}"])
        if isinstance(reply, str):
            # A declined chunk stays as transcribed, and the record says why.
            entries = [(chunk["text"], chunk["text"], "", reply)]
        else:
            proposed = [(c["original"], to_traditional(c["corrected"]), c["reason"]) for c in reply]
            texts[i], verdicts = apply(chunk["text"], [(o, c) for o, c, _ in proposed])
            entries = [(*p, v) for p, v in zip(proposed, verdicts, strict=True)]
        records += [
            {
                "start": chunk["start"],
                "end": chunk["end"],
                "original": original,
                "corrected": corrected,
                "reason": reason,
                "rejected": rejected,
            }
            for original, corrected, reason, rejected in entries
        ]
    return texts, records


def apply(text: str, changes: list[tuple[str, str]]) -> tuple[str, list[str | None]]:
    """Apply each (original, corrected) change that passes `check`, judged in order.

    A change counts together with the ones accepted before it, so many small edits cannot add
    up to a rewrite. Returns the new text and, per change, why it was rejected or None.
    """
    budget = max(MIN_BUDGET, math.ceil(BUDGET_SHARE * len(tokenize(text))))
    accepted: list[tuple[int, str, str]] = []
    verdicts: list[str | None] = []
    for original, corrected in changes:
        at = text.find(original) if original else -1
        reason = None
        if at < 0:
            reason = "not found in the chunk"
        elif text.find(original, at + 1) >= 0:
            reason = "occurs more than once in the chunk"
        elif any(at < a + len(o) and a < at + len(original) for a, o, _ in accepted):
            reason = "overlaps another change"
        elif corrected == original:
            reason = "changes nothing"
        else:
            reason, changed = check(text, _replace(text, [*accepted, (at, original, corrected)]))
            if reason is None and changed > budget:
                reason = f"changes more than {budget} of the chunk's words"
        if reason is None:
            accepted.append((at, original, corrected))
        verdicts.append(reason)
    return _replace(text, accepted), verdicts


def check(original: str, corrected: str) -> tuple[str | None, int]:
    """Why `corrected` may not stand for `original`, or None; and how many words it changes.

    Words are counted as vebench counts them. A Chinese character is a spoken syllable, so a
    misheard one is replaced one for one. Two English words the speech model split may merge
    into one ("and topic" -> "Anthropic") unless one is a filler or a repeat; nothing else is
    added or removed, symbols that are read out (%, $) included, and no word changes script.
    """
    old, new = tokenize(original), tokenize(corrected)
    changed = 0
    for i1, i2, j1, j2 in _differences([t for t, _ in old], [t for t, _ in new]):
        before = Counter(_script(token) for token in old[i1:i2])
        after = Counter(_script(token) for token in new[j1:j2])
        gone, added = before.keys() - after.keys(), after.keys() - before.keys()
        if gone and added:
            return SCRIPT, 0
        if added or any(after[script] > n for script, n in before.items()):
            return ADDS, 0
        if gone or any(after[script] < n for script, n in before.items() if script != "latin"):
            return REMOVES, 0
        merged = before["latin"] - after["latin"]
        if merged > 1 or merged and any(_filler_or_repeat(old, k) for k in range(i1, i2)):
            return REMOVES, 0
        changed += i2 - i1
    symbols_before, symbols_after = _symbols(original), _symbols(corrected)
    if symbols_after - symbols_before:
        return ADDS, 0
    if symbols_before - symbols_after:
        return REMOVES, 0
    return None, changed


def tokenize(text: str) -> list[tuple[str, bool]]:
    """(token, is_cjk) pairs after NFKC folding and lowercasing; punctuation is dropped."""
    text = unicodedata.normalize("NFKC", text).lower().replace("’", "'")
    return [(m.group(0), m.group(1) is not None) for m in _TOKEN.finditer(text)]


def _differences(old: list[str], new: list[str]) -> list[tuple[int, int, int, int]]:
    """The stretches (i1, i2, j1, j2) where `new` differs from `old`, lined up with the fewest
    edits, so a misheard word next to its twin (射謝 -> 謝謝) counts as one word replaced rather
    than one removed and another added."""
    n, m = len(old), len(new)
    # cost[i][j]: the fewest edits that turn old[i:] into new[j:].
    cost = [[n - i + m - j for j in range(m + 1)] for i in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            cost[i][j] = min(
                cost[i + 1][j + 1] + (old[i] != new[j]), cost[i + 1][j] + 1, cost[i][j + 1] + 1
            )
    stretches, i, j, start = [], 0, 0, None
    while i < n or j < m:
        # Keeping two equal words lined up never costs an edit.
        if i < n and j < m and old[i] == new[j]:
            if start:
                stretches.append((start[0], i, start[1], j))
                start = None
            i, j = i + 1, j + 1
            continue
        start = start or (i, j)
        if i < n and j < m and cost[i][j] == cost[i + 1][j + 1] + 1:
            i, j = i + 1, j + 1
        elif i < n and cost[i][j] == cost[i + 1][j] + 1:
            i += 1
        else:
            j += 1
    if start:
        stretches.append((start[0], n, start[1], m))
    return stretches


def _script(token: tuple[str, bool]) -> str:
    text, cjk = token
    if not cjk:
        return "latin"
    code = ord(text)
    if 0x3040 <= code <= 0x30FF:
        return "kana"
    if 0x3100 <= code <= 0x312F or 0x31A0 <= code <= 0x31BF:
        return "bopomofo"
    if 0xAC00 <= code <= 0xD7AF:
        return "hangul"
    return "han"


def _filler_or_repeat(tokens: list[tuple[str, bool]], k: int) -> bool:
    """Whether token k is an English filler or repeats a neighbour; the editor cuts both."""
    word, cjk = tokens[k]
    neighbours = {tokens[i][0] for i in (k - 1, k + 1) if 0 <= i < len(tokens)}
    return not cjk and (word in FILLERS or word in neighbours)


def _symbols(text: str) -> Counter:
    # Symbols ($, +, °) and these marks are read out as words ("100%" is "100 percent"), but
    # vebench's tokens leave them out; other punctuation may change with the words.
    text = unicodedata.normalize("NFKC", text)
    return Counter(ch for ch in text if ch in "%‰‱#&@" or unicodedata.category(ch)[0] == "S")


def _replace(text: str, edits: list[tuple[int, str, str]]) -> str:
    for at, original, corrected in sorted(edits, reverse=True):
        text = text[:at] + corrected + text[at + len(original) :]
    return text


def _request(chunks: list[dict], i: int, settings: Settings) -> dict:
    glossary = "\n".join(settings.glossary) or "(none)"
    before = "\n".join(c["text"] for c in chunks[max(0, i - CONTEXT) : i])
    after = "\n".join(c["text"] for c in chunks[i + 1 : i + 1 + CONTEXT])
    return {
        "model": MODEL,
        "max_tokens": MAX_TOKENS,
        "system": [{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
        "messages": [
            {
                "role": "user",
                "content": [
                    # The same for every chunk of a video, so it is cached with the system prompt.
                    {
                        "type": "text",
                        "text": f"<title>{settings.title}</title>\n<glossary>\n{glossary}\n"
                        "</glossary>",
                        "cache_control": {"type": "ephemeral"},
                    },
                    {
                        "type": "text",
                        "text": f"<before>\n{before}\n</before>\n<chunk>\n{chunks[i]['text']}\n"
                        f"</chunk>\n<after>\n{after}\n</after>\nCorrect the chunk.",
                    },
                ],
            }
        ],
        "output_config": {"effort": EFFORT, "format": {"type": "json_schema", "schema": SCHEMA}},
    }


def _now(client, requests: dict[str, dict]) -> dict:
    # Someone is waiting for the edit: one request per chunk, several at a time. No server-side
    # fallback: a declined chunk stays as transcribed, so every correction comes from MODEL,
    # here and in a batch alike.
    def ask(params):
        return client.messages.create(**params)

    with ThreadPoolExecutor(WORKERS) as pool:
        return dict(zip(requests, pool.map(ask, requests.values()), strict=True))


def _batch(client, requests: dict[str, dict], progress: Callable[[str], None]) -> dict:
    # Half the price for runs nobody waits on, such as the corpus; most batches end within an
    # hour, some take up to 24.
    batch = client.messages.batches.create(
        requests=[{"custom_id": key, "params": params} for key, params in requests.items()]
    )
    while batch.processing_status != "ended":
        done = len(requests) - batch.request_counts.processing
        progress(f"correction batch {batch.id}: {done}/{len(requests)} done")
        time.sleep(POLL_SECONDS)
        batch = client.messages.batches.retrieve(batch.id)
    replies, failed = {}, []
    for item in client.messages.batches.results(batch.id):
        result = item.result
        if result.type == "succeeded":
            replies[item.custom_id] = result.message
        elif result.type == "errored":
            failed.append(f"{item.custom_id} errored: {result.error.error.message}")
        else:
            failed.append(f"{item.custom_id} {result.type}")
    if failed:
        raise RuntimeError(
            f"correction batch {batch.id}: {len(failed)} of {len(requests)} requests did not "
            f"succeed ({', '.join(failed[:3])})"
        )
    return replies


def _changes(message) -> list[dict] | str:
    """The changes in Claude's reply, or why it gave none."""
    if message.stop_reason == "refusal":
        category = getattr(message.stop_details, "category", None) or "no category"
        return f"Claude declined to correct this chunk ({category})"
    if message.stop_reason == "max_tokens":
        raise RuntimeError(f"{MODEL} ran out of tokens correcting a chunk")
    text = next(block.text for block in message.content if block.type == "text")
    return json.loads(text)["changes"]


def _client():
    # Correction runs after hours of transcription; ride out a few more overloaded responses.
    return anthropic.Anthropic(max_retries=5)
