"""Turns the model's answer (light Markdown + LaTeX) into Qt rich-text HTML.

Same rules as the userscript:
  "Correct Answer: A || B"  -> blue answer boxes
  "Explanation: ..."        -> body text
  \\( \\), \\[ \\], $ $, $$ $$  -> math, rendered to images with matplotlib's mathtext
Malformed or unsupported LaTeX falls back to showing the source.
"""

from __future__ import annotations

import html
import io
import re
from typing import Callable

# add_math(tex, display, color_hex) -> HTML snippet (an <img> or a fallback)
MathRenderer = Callable[[str, bool, str], str]

ANSWER_COLOR = "#1967d2"
TEXT_COLOR = "#3c4043"
STRONG_COLOR = "#202124"
# Background opacity for the answer boxes and code spans (text stays solid). Set by the HUD.
_bg_alpha = 1.0


def set_background_alpha(alpha: float) -> None:
    global _bg_alpha
    _bg_alpha = max(0.0, min(1.0, alpha))


def bg(hex_rgb: str) -> str:
    """#RRGGBB -> #AARRGGBB with the current background opacity (Qt rich text understands it)."""
    return f"#{round(_bg_alpha * 255):02x}{hex_rgb.lstrip('#')}"


def code_style() -> str:
    return f"background-color:{bg('#f1f3f4')}; color:#d93025; font-family:Consolas,monospace;"

MATH_PATTERNS = [
    (re.compile(r"\\\[([\s\S]+?)\\\]"), True),                  # \[ ... \]
    (re.compile(r"\$\$([\s\S]+?)\$\$"), True),                  # $$ ... $$
    (re.compile(r"\\\(([\s\S]+?)\\\)"), False),                 # \( ... \)
    (re.compile(r"\$(?![\s$])([^$\n]+?)(?<!\s)\$(?!\d)"), False),  # $ ... $  (not "$5 and $10")
]

ANSWER_RE = re.compile(r"Correct Answer:\s*(.+?)(?=\n\n|\nExplanation:|$)", re.I | re.S)
EXPLANATION_RE = re.compile(r"Explanation:\s*(.+)", re.I | re.S)


# ---------------------------------------------------------------------------
# LaTeX -> image (matplotlib mathtext)
# ---------------------------------------------------------------------------

# mathtext supports most everyday math but not every LaTeX command; map a few
# common ones it lacks to equivalents it has.
_TEX_FIXUPS = [
    (re.compile(r"\\tfrac"), r"\\frac"),
    (re.compile(r"\\left\s*\."), ""),
    (re.compile(r"\\right\s*\."), ""),
    (re.compile(r"\\displaystyle"), ""),
    (re.compile(r"\\textstyle"), ""),
    (re.compile(r"\\[,;:!]\s*"), " "),
    (re.compile(r"\\qquad"), r"\\quad"),
    (re.compile(r"\\dots"), r"\\ldots"),
    (re.compile(r"\\le(?![a-zA-Z])"), r"\\leq"),
    (re.compile(r"\\ge(?![a-zA-Z])"), r"\\geq"),
]


def _normalize_tex(tex: str, display: bool) -> str:
    tex = " ".join(tex.split())  # mathtext is single-line
    for pattern, repl in _TEX_FIXUPS:
        tex = pattern.sub(repl, tex)
    if display:
        tex = re.sub(r"\\frac(?![a-zA-Z])", r"\\dfrac", tex)  # display-size fractions
    return tex


def render_tex_png(tex: str, display: bool, color: str, font_pt: float, scale: float) -> bytes | None:
    """PNG bytes of the rendered formula, or None if mathtext can't parse it."""
    from matplotlib import mathtext  # imported lazily: matplotlib is slow to import
    from matplotlib.font_manager import FontProperties

    from matplotlib import rc_context

    buf = io.BytesIO()
    try:
        with rc_context({"savefig.transparent": True}):  # no white box behind formulas
            mathtext.math_to_image(
                f"${_normalize_tex(tex, display)}$", buf,
                prop=FontProperties(size=font_pt * (1.1 if display else 1.0)),
                dpi=96 * scale, format="png", color=color,
            )
    except Exception:  # noqa: BLE001 - any parse/render failure -> show the source instead
        return None
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Markdown-ish -> Qt rich text
# ---------------------------------------------------------------------------

def _inline(text: str) -> str:
    """Escapes text and applies **bold**, *italic*, `code`. Math placeholders pass through."""
    out = html.escape(text, quote=False)
    out = re.sub(r"\*\*(.+?)\*\*", rf'<b style="color:{STRONG_COLOR}">\1</b>', out)
    out = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\w)", r"<i>\1</i>", out)
    out = re.sub(r"(?<![\w])_(?!\s)(.+?)(?<!\s)_(?![\w])", r"<i>\1</i>", out)
    out = re.sub(r"`(.+?)`", rf'<span style="{code_style()}">\1</span>', out)
    return out


def format_rich_text(text: str, add_math: MathRenderer, color: str) -> str:
    if not text:
        return ""
    blocks: list[str] = []

    def stash(match: re.Match, display: bool) -> str:
        blocks.append(add_math(match.group(1).strip(), display, color))
        return f"\x00{'D' if display else 'I'}{len(blocks) - 1}\x00"

    for pattern, display in MATH_PATTERNS:
        text = pattern.sub(lambda m, d=display: stash(m, d), text)

    parts: list[str] = []
    in_list = False
    for line in text.split("\n"):
        stripped = line.strip()
        list_item = re.match(r"^[-*]\s+(.*)$", stripped)
        if list_item:
            if not in_list:
                parts.append("<ul style=\"margin-top:4px; margin-bottom:4px; margin-left:-20px\">")
                in_list = True
            parts.append(f"<li>{_inline(list_item.group(1))}</li>")
            continue
        if in_list:
            parts.append("</ul>")
            in_list = False
        if stripped.startswith("### "):
            parts.append(f'<p style="font-weight:700; color:{STRONG_COLOR}; margin-top:10px">{_inline(stripped[4:])}</p>')
        elif re.fullmatch(r"\x00D\d+\x00", stripped):
            parts.append(f'<p align="center" style="margin-top:6px; margin-bottom:6px">{stripped}</p>')
        else:
            parts.append(_inline(line) + "<br>")
    if in_list:
        parts.append("</ul>")

    out = "".join(parts)
    out = re.sub(r"(<br>)+$", "", out)
    out = re.sub(r"(?:<br>)*(<p align=\"center\")", r"\1", out)  # no blank line before display math
    out = re.sub(r"\x00([DI])(\d+)\x00", lambda m: blocks[int(m.group(2))], out)
    return out


def format_answer(raw: str, add_math: MathRenderer) -> tuple[str, str]:
    """(answer boxes, explanation) HTML. The HUD pins the first and scrolls the second."""
    answer_match = ANSWER_RE.search(raw)
    explanation_match = EXPLANATION_RE.search(raw)

    if answer_match:
        answers = [a.strip() for a in answer_match.group(1).strip().split(" || ") if a.strip()]
    else:
        answers = ["Analyzing..." if len(raw) < 100 else "Analysis Complete"]

    boxes = "".join(
        '<table width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:10px"><tr>'
        f'<td width="5" bgcolor="{ANSWER_COLOR}"></td>'
        f'<td bgcolor="{bg("#e8f0fe")}" style="padding:12px; color:{ANSWER_COLOR}; font-size:14pt; font-weight:600">'
        f"{format_rich_text(a, add_math, ANSWER_COLOR)}</td></tr></table>"
        for a in answers
    )

    if explanation_match:
        explanation_src = explanation_match.group(1).strip()
    else:
        explanation_src = ANSWER_RE.sub("", raw).strip()
    explanation = format_rich_text(explanation_src, add_math, TEXT_COLOR)
    return boxes, f'<div style="color:{TEXT_COLOR}">{explanation}</div>'


def format_message(message: str, color: str = TEXT_COLOR) -> str:
    return f'<div style="color:{color}">{html.escape(message)}</div>'
