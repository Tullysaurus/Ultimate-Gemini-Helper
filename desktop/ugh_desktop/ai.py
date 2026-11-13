"""OpenRouter streaming client (Server-Sent Events), run on a background thread.

With tools on, one job can take several rounds: the model streams a reply that asks for tool
calls (calculator, see tools.py), we run them, append the results and ask again, until it
answers. While that happens the HUD shows the tool calls and the model's reasoning; only
text that contains the "Correct Answer:" line is shown as the answer.
"""

from __future__ import annotations

import base64
import json
import threading
import time
from dataclasses import dataclass
from typing import Callable

import requests

from . import tools
from .config import NO_EXPLANATION_PROMPT, SYSTEM_PROMPT

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MAX_TOOL_ROUNDS = 6  # after this many rounds of tool calls the model is told to answer


@dataclass
class Callbacks:
    """Called from the worker thread. The app forwards these to Qt signals."""
    on_status: Callable[[str], None]      # "Thinking...", etc.
    on_progress: Callable[[str], None]    # accumulated answer text so far
    on_done: Callable[[str], None]        # final answer text
    on_error: Callable[[str], None]       # user-facing error message
    on_thinking: Callable[[str, int], None] | None = None  # reasoning so far, seconds since the request started
    on_tools: Callable[[list[dict]], None] | None = None   # tool calls so far: {"label", "status", "summary"}


THINKING_EMIT_INTERVAL = 0.25  # s; throttles HUD updates while reasoning streams in


def _reasoning_text(delta: dict) -> str:
    """Readable reasoning in a streamed delta (OpenRouter sends `reasoning`, and/or `reasoning_details`)."""
    if isinstance(delta.get("reasoning"), str):
        return delta["reasoning"]
    out = []
    for item in delta.get("reasoning_details") or []:
        if isinstance(item, dict):  # reasoning.text / reasoning.summary; reasoning.encrypted has nothing readable
            out.append(item.get("text") or item.get("summary") or "")
    return "".join(out)


def _merge_reasoning_details(merged: dict[int, dict], items: list) -> None:
    """Streamed reasoning_details arrive in pieces per index; joined so they can be sent back next round."""
    for item in items or []:
        if not isinstance(item, dict):
            continue
        slot = merged.setdefault(int(item.get("index", 0) or 0), {})
        for key, value in item.items():
            if key in ("text", "summary", "data") and isinstance(value, str):
                slot[key] = slot.get(key, "") + value
            elif value is not None:
                slot[key] = value


def describe_http_error(status: int, body: str) -> str:
    detail = ""
    try:
        detail = (json.loads(body).get("error") or {}).get("message", "")
    except ValueError:
        detail = body[:300]
    if status == 401:
        return "Invalid OpenRouter API key. Right-click the tray icon → Set API key."
    if status == 402:
        return "OpenRouter: insufficient credits for this model."
    if status == 429:
        return "OpenRouter rate limit hit (free models are limited). Wait a moment and try again."
    return f"OpenRouter error {status}" + (f": {detail}" if detail else "")


class _Round:
    """What one streamed reply contained."""

    def __init__(self) -> None:
        self.text = ""
        self.reasoning = ""
        self.calls: dict[int, dict] = {}       # index -> {"id", "name", "arguments"}
        self.details: dict[int, dict] = {}     # merged reasoning_details
        self.finish_reason: str | None = None


class AnalysisJob:
    """One question (possibly several requests). cancel() stops it; callbacks are silenced once cancelled."""

    def __init__(self, api_key: str, model: str, prompt: str, get_png: Callable[[], bytes], request_cfg: dict,
                 callbacks: Callbacks, show_thinking_after: float = -1, use_tools: bool = False,
                 explanations: bool = True):
        self.api_key = api_key
        self.model = model
        self.prompt = prompt
        self.get_png = get_png  # PNG encoding runs on the worker thread, not the UI thread
        self.png = b""
        self.cfg = request_cfg
        self.cb = callbacks
        self.show_thinking_after = show_thinking_after  # seconds; negative = never
        self.use_tools = use_tools
        self.explanations = explanations  # False = the model writes only the answer line
        self.tool_log: list[dict] = []
        self._log_text = ""  # reasoning (and pre-answer text) of finished rounds, for the thinking view
        self._started = 0.0
        self._last_thinking_emit = 0.0
        self._thinking_shown = False
        self._cancelled = threading.Event()
        self._response: requests.Response | None = None
        self._thread = threading.Thread(target=self._run, name="ugh-ai", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def cancel(self) -> None:
        self._cancelled.set()
        resp = self._response
        if resp is not None:
            try:
                resp.close()
            except Exception:  # noqa: BLE001
                pass

    @property
    def cancelled(self) -> bool:
        return self._cancelled.is_set()

    def _emit(self, fn: Callable[[str], None], value: str) -> None:
        if not self.cancelled:
            fn(value)

    def _emit_tools(self) -> None:
        if self.cb.on_tools and not self.cancelled:
            self.cb.on_tools([dict(entry) for entry in self.tool_log])

    # ------------------------------------------------------------------ requests

    def _first_messages(self, with_tools: bool) -> list[dict]:
        image_url = "data:image/png;base64," + base64.b64encode(self.png).decode("ascii")
        system = SYSTEM_PROMPT
        if not self.explanations:
            system += "\n\n" + NO_EXPLANATION_PROMPT
        if with_tools:
            system += "\n\n" + tools.TOOLS_PROMPT
        return [
            {"role": "system", "content": system},
            {"role": "user", "content": [
                {"type": "text", "text": self.prompt + "\n(Note: attached images are part of the question context)"},
                {"type": "image_url", "image_url": {"url": image_url}},
            ]},
        ]

    def _payload(self, messages: list[dict], with_tools: bool) -> dict:
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": True,
            "temperature": self.cfg.get("temperature", 0.2),
            "top_p": self.cfg.get("top_p", 0.95),
            "max_tokens": self.cfg.get("max_tokens", 16384),
            "reasoning": {"effort": self.cfg.get("reasoning_effort", "low")},
        }
        if with_tools:
            payload["tools"] = tools.TOOLS
        return payload

    def _run(self) -> None:
        try:
            self.png = self.get_png()
        except Exception as exc:  # noqa: BLE001
            self._emit(self.cb.on_error, f"Could not encode the screenshot: {exc}")
            return
        if self.cancelled:
            return
        self._started = time.monotonic()
        with_tools = self.use_tools
        messages = self._first_messages(with_tools)

        rounds = 0
        while True:
            result = self._stream(messages, with_tools, first=rounds == 0)
            if result == "no-tools":  # the model/provider doesn't do tool calls: ask again without them
                with_tools = False
                messages = self._first_messages(False)
                continue
            if result is None or self.cancelled:
                return  # error already reported, or cancelled
            rnd: _Round = result

            if not rnd.calls:
                if not rnd.text.strip():
                    self._emit(self.cb.on_error, "The model ran out of tokens while thinking. Try again or pick a different model."
                               if rnd.finish_reason == "length" else
                               "The model returned an empty response. Try again or pick a different model.")
                    return
                self._emit(self.cb.on_done, rnd.text)
                return

            rounds += 1
            if rounds > MAX_TOOL_ROUNDS:
                self._emit(self.cb.on_error, "The model kept calling tools without answering. Try again.")
                return
            self._run_tools(messages, rnd, rounds)
            if self.cancelled:
                return
            if rounds == MAX_TOOL_ROUNDS:
                messages.append({"role": "user", "content": "Tool limit reached. Give your final answer now, without calling tools."})
            self._emit(self.cb.on_status, "Thinking...")

    def _run_tools(self, messages: list[dict], rnd: _Round, round_no: int) -> None:
        calls = [rnd.calls[i] for i in sorted(rnd.calls)]
        for i, call in enumerate(calls):
            call["id"] = call["id"] or f"call_{round_no}_{i}"
        assistant: dict = {
            "role": "assistant",
            "content": rnd.text,
            "tool_calls": [{"id": c["id"], "type": "function",
                            "function": {"name": c["name"], "arguments": c["arguments"] or "{}"}} for c in calls],
        }
        if rnd.details:
            assistant["reasoning_details"] = [rnd.details[i] for i in sorted(rnd.details)]
        messages.append(assistant)

        # Keep this round's thinking (and any text it wrote before the calls) in the thinking view.
        self._log_text += rnd.reasoning + (("\n\n" + rnd.text) if rnd.text.strip() else "") + "\n\n"
        self._maybe_emit_thinking(_Round(), force=True)  # the last throttled bit of this round

        entries = []
        for call in calls:
            try:
                args = json.loads(call["arguments"] or "{}")
            except ValueError:
                args = {}
            entry = {"label": tools.describe(call["name"], args if isinstance(args, dict) else {}),
                     "status": "running", "summary": ""}
            self.tool_log.append(entry)
            entries.append(entry)
        self._emit(self.cb.on_status, "Calculating...")
        self._emit_tools()

        for call, entry in zip(calls, entries):
            if self.cancelled:
                return
            result, summary, ok = tools.run(call["name"], call["arguments"])
            entry["status"] = "done" if ok else "error"
            entry["summary"] = summary
            messages.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(result)})
            self._emit_tools()

    def _maybe_emit_thinking(self, rnd: _Round, force: bool = False) -> None:
        if not self.cb.on_thinking or self.show_thinking_after < 0 or self.cancelled:
            return
        now = time.monotonic()
        text = self._log_text + rnd.reasoning + rnd.text
        if not text.strip():
            return
        if not self.tool_log and now - self._started < self.show_thinking_after:
            return
        if not force and now - self._last_thinking_emit < THINKING_EMIT_INTERVAL:
            return
        self._last_thinking_emit = now
        self.cb.on_thinking(text, int(now - self._started))

    def _stream(self, messages: list[dict], with_tools: bool, first: bool) -> _Round | str | None:
        """One streamed request. Returns the round, "no-tools" (retry without tools), or None (error/cancel)."""
        try:
            self._response = requests.post(
                OPENROUTER_URL,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                    "X-Title": "Ultimate Gemini Helper",
                },
                json=self._payload(messages, with_tools),
                stream=True,
                timeout=(15, self.cfg.get("timeout_seconds", 180)),
            )
        except requests.RequestException as exc:
            self._emit(self.cb.on_error, f"Network error: {exc.__class__.__name__}: {exc}")
            return None

        resp = self._response
        if resp.status_code != 200:
            body = resp.text
            if with_tools and first and resp.status_code in (400, 404) and "tool" in body.lower():
                return "no-tools"
            self._emit(self.cb.on_error, describe_http_error(resp.status_code, body))
            return None

        rnd = _Round()
        answering = False  # the answer line has appeared: stream the text to the HUD as the answer
        try:
            # chunk_size=None: hand over data as soon as it arrives (the default 512-byte
            # chunks would hold back small streamed pieces of the answer).
            for raw in resp.iter_lines(chunk_size=None, decode_unicode=False):
                if self.cancelled:
                    return None
                line = raw.decode("utf-8", "replace").strip() if raw else ""
                if not line.startswith("data:"):
                    continue  # blank lines and ": OPENROUTER PROCESSING" keep-alives
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except ValueError:
                    continue
                if chunk.get("error"):
                    err = chunk["error"]
                    self._emit(self.cb.on_error, f"OpenRouter error: {err.get('message', err)}")
                    return None
                choices = chunk.get("choices") or []
                if not choices:
                    continue
                choice = choices[0]
                rnd.finish_reason = choice.get("finish_reason") or rnd.finish_reason
                delta = choice.get("delta") or {}

                for tc in delta.get("tool_calls") or []:
                    slot = rnd.calls.setdefault(int(tc.get("index", len(rnd.calls)) or 0),
                                                {"id": None, "name": "", "arguments": ""})
                    if tc.get("id"):
                        slot["id"] = tc["id"]
                    fn = tc.get("function") or {}
                    if fn.get("name") and fn["name"] != slot["name"]:
                        slot["name"] += fn["name"]
                    if fn.get("arguments"):
                        slot["arguments"] += fn["arguments"]
                _merge_reasoning_details(rnd.details, delta.get("reasoning_details"))

                if delta.get("content"):
                    rnd.text += delta["content"]
                    # With tools, text before the answer line is often "let me calculate..."; it goes
                    # into the thinking view instead of flashing up as the answer.
                    if not answering and (not with_tools or "correct answer" in rnd.text.lower()):
                        answering = True
                    if answering:
                        self._emit(self.cb.on_progress, rnd.text)
                    else:
                        self._maybe_emit_thinking(rnd)
                elif delta.get("reasoning") or delta.get("reasoning_details"):
                    rnd.reasoning += _reasoning_text(delta)
                    if not answering:
                        if not self._thinking_shown:
                            self._thinking_shown = True
                            self._emit(self.cb.on_status, "Thinking...")
                        self._maybe_emit_thinking(rnd)
        except Exception as exc:  # noqa: BLE001
            # cancel() closes the response from another thread, which can surface as
            # odd errors inside http.client; those are expected and ignored.
            if not self.cancelled:
                self._emit(self.cb.on_error, f"Connection lost: {exc.__class__.__name__}: {exc}")
            return None
        finally:
            resp.close()
        return rnd
