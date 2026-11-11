"""OpenRouter streaming client (Server-Sent Events), run on a background thread."""

from __future__ import annotations

import base64
import json
import threading
import time
from dataclasses import dataclass
from typing import Callable

import requests

from .config import SYSTEM_PROMPT

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


@dataclass
class Callbacks:
    """Called from the worker thread. The app forwards these to Qt signals."""
    on_status: Callable[[str], None]      # "Thinking...", etc.
    on_progress: Callable[[str], None]    # accumulated answer text so far
    on_done: Callable[[str], None]        # final answer text
    on_error: Callable[[str], None]       # user-facing error message
    on_thinking: Callable[[str, int], None] | None = None  # reasoning so far, seconds since the request started


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


class AnalysisJob:
    """One request. cancel() stops it; callbacks are silenced once cancelled."""

    def __init__(self, api_key: str, model: str, prompt: str, get_png: Callable[[], bytes], request_cfg: dict,
                 callbacks: Callbacks, show_thinking_after: float = -1):
        self.api_key = api_key
        self.model = model
        self.prompt = prompt
        self.get_png = get_png  # PNG encoding runs on the worker thread, not the UI thread
        self.png = b""
        self.cfg = request_cfg
        self.cb = callbacks
        self.show_thinking_after = show_thinking_after  # seconds; negative = never
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

    def _payload(self) -> dict:
        image_url = "data:image/png;base64," + base64.b64encode(self.png).decode("ascii")
        return {
            "model": self.model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": [
                    {"type": "text", "text": self.prompt + "\n(Note: attached images are part of the question context)"},
                    {"type": "image_url", "image_url": {"url": image_url}},
                ]},
            ],
            "stream": True,
            "temperature": self.cfg.get("temperature", 0.2),
            "top_p": self.cfg.get("top_p", 0.95),
            "max_tokens": self.cfg.get("max_tokens", 16384),
            "reasoning": {"effort": self.cfg.get("reasoning_effort", "low")},
        }

    def _run(self) -> None:
        try:
            self.png = self.get_png()
        except Exception as exc:  # noqa: BLE001
            self._emit(self.cb.on_error, f"Could not encode the screenshot: {exc}")
            return
        if self.cancelled:
            return
        started = time.monotonic()
        try:
            self._response = requests.post(
                OPENROUTER_URL,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                    "X-Title": "Ultimate Gemini Helper",
                },
                json=self._payload(),
                stream=True,
                timeout=(15, self.cfg.get("timeout_seconds", 180)),
            )
        except requests.RequestException as exc:
            self._emit(self.cb.on_error, f"Network error: {exc.__class__.__name__}: {exc}")
            return

        resp = self._response
        if resp.status_code != 200:
            self._emit(self.cb.on_error, describe_http_error(resp.status_code, resp.text))
            return

        text = ""
        finish_reason = None
        thinking_shown = False
        reasoning = ""
        last_thinking_emit = 0.0
        try:
            # chunk_size=None: hand over data as soon as it arrives (the default 512-byte
            # chunks would hold back small streamed pieces of the answer).
            for raw in resp.iter_lines(chunk_size=None, decode_unicode=False):
                if self.cancelled:
                    return
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
                    return
                choices = chunk.get("choices") or []
                if not choices:
                    continue
                choice = choices[0]
                finish_reason = choice.get("finish_reason") or finish_reason
                delta = choice.get("delta") or {}
                if delta.get("content"):
                    text += delta["content"]
                    self._emit(self.cb.on_progress, text)
                elif (delta.get("reasoning") or delta.get("reasoning_details")) and not text:
                    if not thinking_shown:
                        thinking_shown = True
                        self._emit(self.cb.on_status, "Thinking...")
                    reasoning += _reasoning_text(delta)
                    now = time.monotonic()
                    if (self.cb.on_thinking and self.show_thinking_after >= 0 and reasoning.strip()
                            and now - started >= self.show_thinking_after
                            and now - last_thinking_emit >= THINKING_EMIT_INTERVAL):
                        last_thinking_emit = now
                        if not self.cancelled:
                            self.cb.on_thinking(reasoning, int(now - started))
        except Exception as exc:  # noqa: BLE001
            # cancel() closes the response from another thread, which can surface as
            # odd errors inside http.client; those are expected and ignored.
            if not self.cancelled:
                self._emit(self.cb.on_error, f"Connection lost: {exc.__class__.__name__}: {exc}")
            return
        finally:
            resp.close()

        if not text.strip():
            self._emit(self.cb.on_error, "The model ran out of tokens while thinking. Try again or pick a different model."
                       if finish_reason == "length" else
                       "The model returned an empty response. Try again or pick a different model.")
            return
        self._emit(self.cb.on_done, text)
