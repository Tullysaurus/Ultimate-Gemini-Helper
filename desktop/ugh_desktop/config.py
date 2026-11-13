"""Settings (JSON file in %APPDATA%\\UGH) and the API key (Windows Credential Manager)."""

from __future__ import annotations

import copy
import json
import os
from pathlib import Path

import keyring

APP_NAME = "UGH"
KEYRING_SERVICE = "UGH Desktop"
KEYRING_USER = "openrouter"

DEFAULT_MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free"

SYSTEM_PROMPT = r"""
You are an expert educational AI assistant. Your task is to analyze the preceding question or text and identify the correct answer.
STRICT FORMATTING RULES:
1. **Correct Answer**: Put the answer on the "Correct Answer:" line.
   - **Multiple choice** (answer options are shown): number the options of the question 1, 2, 3, ... in reading order: left-to-right, then top-to-bottom. Ignore any letters or numbers the options are already labelled with. Write the correct option's number, a period and a space, then the option's text copied EXACTLY as shown, character for character, including spelling mistakes, capitalization and weird punctuation, but without the option's own label (like "C)" or "c."). Example: if the third option reads "Anwser", write "3. Anwser".
   - **Free response** (no options to choose from): write just the answer, with no number.
2. **Explanation**: For multiple choice, give concise reasoning on an "Explanation:" line below the answer. For free response, do NOT include an explanation; output only the "Correct Answer:" line.
3. **Rich Text** (explanation only; the answer text must stay exactly as shown):
   - Use **bold** for key terms.
   - Use *italics* for emphasis or definitions.
   - Use lists (lines starting with -) for steps or multiple points.
   - Use `code` formatting for technical terms if relevant (not for math).
   - Write math in LaTeX: \( ... \) for inline math and \[ ... \] for display math. Make sure every brace and delimiter is balanced.
4. **No Chattyness**: Do NOT ask if the user needs more help. Do NOT ask follow-up questions. End the response immediately after the answer (free response) or the explanation (multiple choice).
5. **No Images**: Do not include images or references to images in your output.
6. **Multiple Answers**: If more than one option is correct (e.g. "select all that apply"), or there are several questions, list every answer in the formats above, separated by " || " (spaces included).
7. **Think Efficiently**: Keep your reasoning short; these are routine questions and speed matters.
   - Read the answer options once. While reasoning, refer to them only by their number (1, 2, 3, ...); never rewrite the options' text while thinking. Copy the chosen option's text exactly once, in the final answer.
   - Check your answer at most once. Do not re-read, re-list or re-verify the options again after that.
   - Do not do long arithmetic in your head or write out step-by-step calculations while reasoning.
No matter what, you are to always follow these formatting rules in your responses. Do not use any previous context to generate your responses, treat each prompt as its own chat.
OUTPUT STRUCTURE (multiple choice):
Correct Answer: [N. Answer1 || N. Answer2 || ...]

Explanation: [Rich Text Explanation]

OUTPUT STRUCTURE (free response):
Correct Answer: [Answer]
""".strip()

DEFAULTS: dict = {
    "model": DEFAULT_MODEL,
    "capture_prompt": "Answer the question(s) shown in the attached screenshot.",
    "menu_key": "f9",                     # opens the action menu; then press a number or an arrow key (0 cancels)
    "menu_timeout_seconds": 5,            # menu closes by itself after this long without a choice
    "double_tap_ms": 350,                 # menu key twice within this = repeat the last capture (0 = off)
    "hud": {
        "corner": "top-right",            # top-left | top-right | bottom-left | bottom-right
        "margin": 20,                     # px from the screen edges
        "width": 420,                     # px
        "max_height_ratio": 0.7,          # of the screen height
        "background_opacity": 0.6,        # panel backgrounds only (text stays solid), 0.0 - 1.0
    },
    "request": {
        "temperature": 0.2,
        "top_p": 0.95,
        "max_tokens": 16384,              # reasoning models need room to "think"
        "reasoning_effort": "low",
        "timeout_seconds": 180,
    },
    "max_image_side": 2560,               # full-screen captures are downscaled to this (px)
    "tools": True,                        # let the model use calculator tools (math, statistics, solving)
    "show_thinking_after_seconds": 8,     # show the model's reasoning once a request takes this long (0 = right away, -1 = never)
}


def config_dir() -> Path:
    base = os.environ.get("APPDATA") or str(Path.home())
    path = Path(base) / APP_NAME
    path.mkdir(parents=True, exist_ok=True)
    return path


def config_path() -> Path:
    return config_dir() / "config.json"


def _merge(defaults: dict, user: dict) -> dict:
    out = copy.deepcopy(defaults)
    for key, value in user.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _merge(out[key], value)
        else:
            out[key] = value
    return out


def load_config() -> dict:
    """Reads config.json (creating it with defaults on first run) merged over DEFAULTS."""
    path = config_path()
    user: dict = {}
    unreadable = False
    if path.exists():
        try:
            user = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            user, unreadable = {}, True  # keep the broken file so the user's edits aren't lost
    original = copy.deepcopy(user)
    user.pop("hotkeys", None)  # per-action hotkeys were replaced by the menu key
    if isinstance(user.get("hud"), dict):
        user["hud"].pop("opacity", None)  # whole-window opacity was removed (background_opacity remains)
    cfg = _merge(DEFAULTS, user)
    # Write back new settings (and drop obsolete ones) so they show up in the file for editing.
    if not unreadable and cfg != original:
        save_config(cfg)
    return cfg


def save_config(cfg: dict) -> None:
    config_path().write_text(json.dumps(cfg, indent=2), encoding="utf-8")


def get_api_key() -> str:
    try:
        return keyring.get_password(KEYRING_SERVICE, KEYRING_USER) or ""
    except Exception:  # noqa: BLE001 - a broken keyring backend shouldn't crash the app
        return ""


def set_api_key(key: str) -> None:
    key = key.strip()
    if key:
        keyring.set_password(KEYRING_SERVICE, KEYRING_USER, key)
    else:
        try:
            keyring.delete_password(KEYRING_SERVICE, KEYRING_USER)
        except keyring.errors.PasswordDeleteError:
            pass


def key_hint(key: str) -> str:
    return f"{key[:8]}…{key[-4:]}" if key else ""
