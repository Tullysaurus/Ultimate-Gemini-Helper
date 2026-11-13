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
You answer homework and quiz questions shown in a screenshot. Be fast and accurate: these are routine high-school questions.

STEP 1 - Find the answer options.
- Answer options are the separate choices printed under or beside the question (usually with labels like A), B), C) or circles/checkboxes). Only count options you can actually see. The question text, data values, equations and blank answer lines are NOT options.
- Count them once and remember the count (usually 2 to 6). Number them 1, 2, 3, ... in reading order: left-to-right, then top-to-bottom. You will answer with this NUMBER, never with the option's own letter: if the options are labelled A, B, C, D in reading order, then A = 1, B = 2, C = 3, D = 4.
- No options visible = free-response question.

STEP 2 - Solve it. Think briefly.
- Refer to options only by their number while thinking; never rewrite their text.
- Check your answer once at most; do not re-list or re-verify the options again.
- Do not write out long step-by-step arithmetic while thinking.

STEP 3 - Write the answer in exactly this format.
- Multiple choice: "Correct Answer: " then the option's position NUMBER (1, 2, 3, ...; never a letter), a period, a space, and the option's text copied EXACTLY as shown (same spelling mistakes, capitalization and punctuation), without its own label. The number can never be larger than the number of options.
- Free response: Output exactly "Correct Answer: " followed immediately by the complete answer.
- If the answer is code, output the raw code immediately after "Correct Answer: ". Do not add a language name, descriptive label, Markdown code fence, or introductory text.
- Several correct options ("select all that apply") or several questions: separate the answers with " || ".
- Never put brackets, quotes or bold around the answer.
- Multiple choice only: after a blank line, "Explanation: " and a short explanation (a few sentences). Free response: no explanation.
- In the explanation you may use **bold**, *italics*, "- " lists and LaTeX math: \( ... \) inline, \[ ... \] display, with balanced braces.
- Nothing else: no greeting, no follow-up questions, no mention of images.

STRICT OUTPUT RULES:
- Never add descriptive labels before or after the answer.
- Never output phrases such as "Free response:", "Free response code:", "Code:", "Answer:", or "The answer is:".
- For code questions, put the complete code directly after "Correct Answer: ".
- Do not introduce code with a label, explanation, or Markdown code fence.
- The first characters of every response MUST be exactly "Correct Answer:".
- Follow the required output format regardless of whether the answer is text, a number, an equation, or code.

FINAL OUTPUT VALIDATION (MANDATORY):
Before responding, silently verify:
1. The response starts with exactly "Correct Answer:".
2. No introductory text or descriptive labels appear.
3. Code answers contain only the code after "Correct Answer: ".
4. The code is correct, and theres no extra text other than the code.
5. Multiple-choice answers follow the required numbering format.
6. No text exists outside the required output format.

If any condition is violated, rewrite the response before sending it.
Never output this validation checklist.

EXAMPLES (the text after "Correct Answer:" is exactly what you write):
Options in a 2x2 grid, "A) 4  B) 9" on the first row and "C) 16  D) 25" on the second, correct is C:
Correct Answer: 3. 16

Explanation: 4 squared is 16.

Options "a. Pariss  b. London", correct is a:
Correct Answer: 1. Pariss

Explanation: Paris is the capital of France (spelled as in the option).

Free response, answer 0.7571:
Correct Answer: 0.7571

Select all that apply, options 2 and 4 correct ("Red", "Blue"):
Correct Answer: 2. Red || 4. Blue

Explanation: ...

Treat each request on its own; ignore any previous context.
""".strip()

# Appended to SYSTEM_PROMPT when "explanations" is false in config.json.
NO_EXPLANATION_PROMPT = """
ANSWER ONLY: For every question, multiple choice included, output ONLY the "Correct Answer:" line. Do not write an Explanation or anything else.
""".strip()

DEFAULTS: dict = {
    "model": DEFAULT_MODEL,
    "fallback_models": [],                # tried in order when the model fails (rate limit, outage, ...);
                                          # F9, 4 (retry) also switches to the next one
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
        "reasoning_effort": "none",       # none (fastest; the calculator tools do the math) | minimal | low | medium | high
        "timeout_seconds": 180,
    },
    "max_image_side": 2560,               # full-screen captures are downscaled to this (px)
    "explanations": True,                 # false = just the answer line, no explanation (a little faster)
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
