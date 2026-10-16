import itertools
import json
import re
from types import SimpleNamespace

import anthropic
import httpx2
import pytest
import vebench.transcript

from vework import correct
from vework.correct import ADDS, REMOVES, SCRIPT, apply, check


class FakeClaude:
    """Answers like the Messages and Batches APIs, with `reply(chunk_text)` as the changes."""

    def __init__(self, reply, batch_polls=1, failed=None):
        self.reply, self.polls, self.failed = reply, batch_polls, failed or {}
        self.requests = []
        self.messages = SimpleNamespace(
            create=self._answer,
            batches=SimpleNamespace(
                create=self._batch_create, retrieve=self._retrieve, results=self._results
            ),
        )
        self.api_key, self.auth_token, self.credentials = "test", None, None
        self.models = SimpleNamespace(retrieve=lambda model: SimpleNamespace(id=model))

    def _answer(self, **params):
        self.requests.append(params)
        chunk = re.search(r"<chunk>\n(.*)\n</chunk>", params["messages"][0]["content"][1]["text"])
        changes = self.reply(chunk.group(1))
        if changes == "refusal":
            details = SimpleNamespace(category="general_harms")
            return SimpleNamespace(stop_reason="refusal", stop_details=details, content=[])
        text = json.dumps(
            {
                "changes": [
                    dict(zip(("original", "corrected", "reason"), c, strict=True)) for c in changes
                ]
            }
        )
        blocks = [
            SimpleNamespace(type="thinking", thinking=""),
            SimpleNamespace(type="text", text=text),
        ]
        return SimpleNamespace(stop_reason="end_turn", stop_details=None, content=blocks)

    def _batch_create(self, requests):
        self.batch = requests
        return self._retrieve("msgbatch_1")

    def _retrieve(self, batch_id):
        self.polls -= 1
        status = "ended" if self.polls < 0 else "in_progress"
        counts = SimpleNamespace(processing=0 if status == "ended" else len(self.batch))
        return SimpleNamespace(id=batch_id, processing_status=status, request_counts=counts)

    def _results(self, batch_id):
        # Batch results come in any order.
        for item in reversed(self.batch):
            result = self.failed.get(item["custom_id"]) or SimpleNamespace(
                type="succeeded", message=self._answer(**item["params"])
            )
            yield SimpleNamespace(custom_id=item["custom_id"], result=result)


def chunk(start, end, text, language="Chinese"):
    return {"start": start, "end": end, "text": text, "language": language}


def use(monkeypatch, claude):
    monkeypatch.setattr(correct, "_client", lambda: claude)
    return claude


def test_a_misheard_character_is_replaced_one_for_one():
    assert apply("我們在來看下一個例子。", [("我們在來看", "我們再來看")]) == (
        "我們再來看下一個例子。",
        [None],
    )


@pytest.mark.parametrize(
    "original, corrected, reason",
    [
        ("cuts the pauses", "cuts all the pauses", ADDS),
        ("林家穎", "林家佳穎", ADDS),
        ("嗯，那個，我們", "我們", REMOVES),
        ("我們我們先看", "我們先看", REMOVES),
        ("挑題就要", "挑take就要", SCRIPT),
        ("用 API 呼叫", "用愛批愛呼叫", SCRIPT),
        ("我們走吧", "우리走吧", SCRIPT),
        ("uh so we go", "also we go", REMOVES),
        ("the the result", "they result", REMOVES),
        ("one two three four five", "won four five", REMOVES),
        ("漲了 100 塊", "漲了 100% 塊", ADDS),
        ("價格是 5 元", "價格是 $5 元", ADDS),
        ("漲了 100% 塊", "漲了 100 塊", REMOVES),
    ],
)
def test_changes_that_add_remove_or_move_words_are_rejected(original, corrected, reason):
    assert check(original, corrected)[0] == reason
    assert apply(original, [(original, corrected)]) == (original, [reason])


@pytest.mark.parametrize(
    "text, original, corrected",
    [
        ("今天就到這裡，射謝。", "射謝", "謝謝"),
        ("我們下次見，拜掰", "拜掰", "掰掰"),
        ("這個要曼慢", "曼慢", "慢慢"),
        ("ok see you by bye", "by bye", "bye bye"),
    ],
)
def test_a_misheard_word_next_to_its_twin_is_replaced(text, original, corrected):
    assert apply(text, [(original, corrected)]) == (text.replace(original, corrected), [None])


def test_any_single_misheard_character_may_be_replaced():
    # Texts of two characters repeated leave many equally short ways to line words up.
    for chars in itertools.product("甲乙", repeat=6):
        text = "".join(chars)
        for i, new in itertools.product(range(len(text)), "甲乙丙"):
            if new != text[i]:
                corrected = text[:i] + new + text[i + 1 :]
                assert check(text, corrected) == (None, 1), corrected


def test_words_are_counted_as_vebench_counts_them():
    every = "".join(chr(c) for c in range(0x20, 0x323B0) if not 0xD800 <= c < 0xE000)
    assert correct.tokenize(every) == vebench.transcript.tokenize(every)


def test_misheard_english_words_may_merge_and_change_case():
    text = "這是 and topic 做的 claude 模型"
    new, verdicts = apply(text, [("and topic", "Anthropic"), ("claude", "Claude")])
    assert new == "這是 Anthropic 做的 Claude 模型" and verdicts == [None, None]


def test_quotes_that_are_missing_ambiguous_or_overlapping_are_rejected():
    text = "我們在來看，在來看。"
    changes = [("再來看", "在來看"), ("在來看", "再來看"), ("們在來看，", "們再來看，"),
               ("看，在", "看，再"), ("我們在", "我們再"), ("在來看。", "在來看。")]  # fmt: skip
    new, verdicts = apply(text, changes)
    assert verdicts == [
        "not found in the chunk",
        "occurs more than once in the chunk",
        None,
        "overlaps another change",
        "overlaps another change",
        "changes nothing",
    ]
    assert new == "我們再來看，在來看。"


def test_many_small_changes_cannot_add_up_to_a_rewrite():
    text = "一二三四五六七八九十"  # ten words: the budget is the minimum, four
    changes = [(c, "零") for c in "一二三四五"]
    new, verdicts = apply(text, changes)
    assert verdicts == [None] * 4 + ["changes more than 4 of the chunk's words"]
    assert new == "零零零零五六七八九十"


def test_requests_carry_the_context_and_cache_the_prompt(monkeypatch):
    claude = use(monkeypatch, FakeClaude(lambda text: []))
    chunks = [chunk(i, i + 1, f"第{i}句。") for i in range(6)]
    settings = correct.Settings("我的頻道", ("林佳穎", "Kubernetes"))
    texts, records = correct.correct(chunks, settings)

    assert texts == [c["text"] for c in chunks] and records == []
    # Chunks are sent several at a time, so requests arrive in any order.
    third = next(
        r for r in claude.requests if "<chunk>\n第3句。" in r["messages"][0]["content"][1]["text"]
    )
    assert third["model"] == "claude-sonnet-5-5"
    assert third["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert third["output_config"]["format"]["schema"] == correct.SCHEMA
    video, text = third["messages"][0]["content"]
    assert video["cache_control"] == {"type": "ephemeral"}
    assert "<title>我的頻道</title>" in video["text"] and "林佳穎\nKubernetes" in video["text"]
    assert "<before>\n第1句。\n第2句。\n</before>" in text["text"]
    assert "<chunk>\n第3句。\n</chunk>" in text["text"]
    assert "<after>\n第4句。\n第5句。\n</after>" in text["text"]
    # The per-video block is identical for every chunk, so it is read from the cache.
    assert all(r["messages"][0]["content"][0] == video for r in claude.requests)
    # No fallback to another model: every correction comes from correct.MODEL.
    assert "fallbacks" not in third


def test_every_proposal_is_recorded_and_only_the_safe_ones_applied(monkeypatch):
    replies = {
        "我們在來看下一個。": [
            (
                "我們在來看",
                "我们再来看",
                "在 should be 再.",
            ),  # Simplified, as models sometimes write
            ("下一個", "下一個重點", "Clearer."),
        ],
        "Okay so that is it.": [],
    }
    use(monkeypatch, FakeClaude(replies.get))
    chunks = [
        chunk(1.0, 3.0, "我們在來看下一個。"),
        chunk(4.0, 5.0, "Okay so that is it.", "English"),
    ]
    texts, records = correct.correct(chunks, correct.Settings("talk"))
    assert texts == ["我們再來看下一個。", "Okay so that is it."]
    assert records == [
        {"start": 1.0, "end": 3.0, "original": "我們在來看", "corrected": "我們再來看",
         "reason": "在 should be 再.", "rejected": None},
        {"start": 1.0, "end": 3.0, "original": "下一個", "corrected": "下一個重點",
         "reason": "Clearer.", "rejected": ADDS},
    ]  # fmt: skip


def test_only_chinese_and_english_chunks_are_corrected(monkeypatch):
    claude = use(monkeypatch, FakeClaude(lambda text: [(text, text + "！", "x")]))
    chunks = [chunk(0, 1, "会社に行く", "Japanese"), chunk(2, 3, "我們走吧", "Chinese")]
    texts, _ = correct.correct(chunks, correct.Settings("talk"))
    assert len(claude.requests) == 1 and texts == ["会社に行く", "我們走吧！"]
    assert "会社に行く" in claude.requests[0]["messages"][0]["content"][1]["text"]


def test_a_declined_chunk_stays_as_transcribed_and_is_recorded(monkeypatch):
    use(monkeypatch, FakeClaude(lambda text: "refusal"))
    texts, records = correct.correct([chunk(0, 2, "我們走吧")], correct.Settings("talk"))
    assert texts == ["我們走吧"]
    assert records[0]["rejected"] == "Claude declined to correct this chunk (general_harms)"


def test_a_batch_waits_and_matches_results_to_chunks(monkeypatch):
    monkeypatch.setattr(correct, "POLL_SECONDS", 0)
    claude = use(monkeypatch, FakeClaude(lambda text: [(text, text.replace("在", "再"), "x")]))
    messages = []
    chunks = [chunk(0, 1, "在來"), chunk(2, 3, "好的", "English"), chunk(4, 5, "在見")]
    texts, records = correct.correct(chunks, correct.Settings("talk", batch=True), messages.append)
    assert texts == ["再來", "好的", "再見"]
    assert [c["custom_id"] for c in claude.batch] == ["chunk-0", "chunk-1", "chunk-2"]
    assert "correction batch msgbatch_1: 0/3 done" in messages
    assert [r["rejected"] for r in records] == [None, "changes nothing", None]


def test_a_batch_request_that_did_not_succeed_fails_the_run_and_says_why(monkeypatch):
    monkeypatch.setattr(correct, "POLL_SECONDS", 0)
    error = SimpleNamespace(type="invalid_request_error", message="max_tokens: too large")
    failed = {
        "chunk-1": SimpleNamespace(type="expired"),
        "chunk-2": SimpleNamespace(type="errored", error=SimpleNamespace(error=error)),
    }
    use(monkeypatch, FakeClaude(lambda text: [], failed=failed))
    chunks = [chunk(0, 1, "一"), chunk(2, 3, "二"), chunk(4, 5, "三")]
    with pytest.raises(RuntimeError) as failure:
        correct.correct(chunks, correct.Settings("talk", batch=True))
    assert "2 of 3 requests did not succeed" in str(failure.value)
    assert "chunk-2 errored: max_tokens: too large" in str(failure.value)
    assert "chunk-1 expired" in str(failure.value)


def test_api_errors_fail_with_a_message(monkeypatch):
    claude = use(monkeypatch, FakeClaude(lambda text: []))

    def fail(**params):
        raise anthropic.AnthropicError("overloaded")

    claude.messages.create = fail
    with pytest.raises(RuntimeError, match="transcript correction failed: overloaded"):
        correct.correct([chunk(0, 1, "一")], correct.Settings("talk"))


def api(sent):
    """The real SDK client, answered by a fake Claude API that records each request."""
    reply = {"changes": [{"original": "在來", "corrected": "再來", "reason": "homophone"}]}
    message = {
        "id": "msg_1", "type": "message", "role": "assistant", "model": correct.MODEL,
        "content": [{"type": "thinking", "thinking": "", "signature": "s"},
                    {"type": "text", "text": json.dumps(reply, ensure_ascii=False)}],
        "stop_reason": "end_turn", "stop_sequence": None,
        "usage": {"input_tokens": 900, "output_tokens": 40},
    }  # fmt: skip
    batch = {
        "id": "msgbatch_1", "type": "message_batch", "processing_status": "ended",
        "request_counts": {"processing": 0, "succeeded": 1, "errored": 0, "canceled": 0,
                           "expired": 0},
        "results_url": "https://api.anthropic.com/v1/messages/batches/msgbatch_1/results",
        "created_at": "2026-10-15T00:00:00Z", "expires_at": "2026-10-16T00:00:00Z",
    }  # fmt: skip

    def handle(request):
        sent.append(request)
        path = request.url.path
        if path == "/v1/messages":
            return httpx2.Response(200, json=message)
        if path.endswith("/results"):
            line = {"custom_id": "chunk-0", "result": {"type": "succeeded", "message": message}}
            return httpx2.Response(200, text=json.dumps(line) + "\n")
        return httpx2.Response(200, json=batch)

    transport = httpx2.MockTransport(handle)
    http = anthropic.DefaultHttpxClient(transport=transport)
    return anthropic.Anthropic(api_key="test", http_client=http, max_retries=0)


def test_a_request_reaches_the_api_as_the_sdk_sends_it(monkeypatch):
    sent = []
    use(monkeypatch, api(sent))
    texts, records = correct.correct([chunk(0, 2, "我們在來看")], correct.Settings("talk"))
    assert texts == ["我們再來看"] and records[0]["rejected"] is None
    body = json.loads(sent[0].content)
    assert "anthropic-beta" not in sent[0].headers and "fallbacks" not in body
    assert body["model"] == "claude-sonnet-5-5"
    assert body["output_config"] == {
        "effort": "medium",
        "format": {"type": "json_schema", "schema": correct.SCHEMA},
    }
    assert body["system"][0]["cache_control"] == {"type": "ephemeral"}


def test_a_batch_round_trips_through_the_sdk(monkeypatch):
    sent = []
    use(monkeypatch, api(sent))
    settings = correct.Settings("talk", batch=True)
    texts, _ = correct.correct([chunk(0, 2, "我們在來看")], settings)
    assert texts == ["我們再來看"]
    created = json.loads(sent[0].content)
    assert sent[0].url.path == "/v1/messages/batches"
    assert created["requests"][0]["custom_id"] == "chunk-0"
    assert "fallbacks" not in created["requests"][0]["params"]


def test_glossary_lines_skip_blanks_and_comments(tmp_path):
    path = tmp_path / "glossary.txt"
    path.write_text("# guests\n林佳穎\n\n  Kubernetes  \n", encoding="utf-8")
    assert correct.read_glossary(path) == ("林佳穎", "Kubernetes")


def test_missing_key_is_named_before_any_request(no_credentials):
    with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY.*--env-file ../.env"):
        correct.require_credentials()


@pytest.mark.claude
def test_claude_fixes_a_glossary_term_without_adding_words():
    chunks = [
        chunk(0.0, 4.0, "大家好，今天來聊設計工具。"),
        chunk(5.0, 9.0, "我的設計稿都放在 fig ma 裡面，嗯，很方便。"),
        chunk(10.0, 13.0, "那我們開始吧。"),
    ]
    texts, records = correct.correct(chunks, correct.Settings("設計工具分享", ("Figma",)))
    assert "Figma" in texts[1] and "嗯" in texts[1]
    assert all(len(correct.tokenize(t)) <= len(correct.tokenize(c["text"]))
               for t, c in zip(texts, chunks, strict=True))  # fmt: skip
    assert any(r["rejected"] is None for r in records)
