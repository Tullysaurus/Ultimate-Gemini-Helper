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
You are an expert educational AI assistant. Your task is to analyze the preceeding question or text and identify the correct answer.
STRICT FORMATTING RULES:
1. **Correct Answer**: Provide the direct answer clearly.
2. **Explanation**: Provide concise reasoning below it.
3. **Rich Text**:
   - Use **bold** for key terms and the correct option.
   - Use *italics* for emphasis or definitions.
   - Use lists (lines starting with -) for steps or multiple points.
   - Use `code` formatting for technical terms if relevant (not for math).
   - Write math in LaTeX: \( ... \) for inline math and \[ ... \] for display math. Make sure every brace and delimiter is balanced.
4. **No Chattyness**: Do NOT ask if the user needs more help. Do NOT ask follow-up questions. End the response immediately after the explanation.
5. **No Images**: Do not include images or references to images in your output.
6. **Proper Answers**: Make sure that the output answers are always IDENTICAL to the original choices, include any spelling mistakes or weird punctuation.
7. **Lists**: If there are multiple correct answers, you are to list them, separated by " || " (spaces included).
No matter what, you are to always follow these formatting rules in your responses. Do not use any previous context to generate your responses, treat each prompt as its own chat.
OUTPUT STRUCTURE:
Correct Answer: [Answer1 || Answer2 || ...]

Explanation: [Rich Text Explanation]
""".strip()

DEFAULTS: dict = {
    "model": DEFAULT_MODEL,
    "capture_prompt": "Answer the question(s) shown in the attached screenshot.",
    "menu_key": "f9",                     # opens the action menu; then press 1-5 (0 cancels)
    "menu_timeout_seconds": 5,            # menu closes by itself after this long without a choice
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
