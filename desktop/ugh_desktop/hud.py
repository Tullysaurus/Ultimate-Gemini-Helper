"""The heads-up display: a click-through, non-activating, always-on-top card in a screen corner.

Styled like the userscript's response popup (white card, grey header, blue answer boxes).
It never takes focus or mouse input; everything is driven by the global menu key.
The answer boxes are pinned at the top; only the explanation below them scrolls.
"""

from __future__ import annotations

from PyQt6.QtCore import QRectF, QSize, Qt, QTimer, QUrl
from PyQt6.QtGui import QColor, QGuiApplication, QImage, QPainter, QPen
from PyQt6.QtWidgets import QFrame, QHBoxLayout, QLabel, QTextBrowser, QVBoxLayout, QWidget

from . import formatting, winapi

FONT_FAMILY = "Roboto, 'Segoe UI', Arial, sans-serif"
BODY_PT = 10.5
ANSWER_PT = 14

def _rgba(hex_rgb: str, alpha: float) -> str:
    r, g, b = (int(hex_rgb[i:i + 2], 16) for i in (1, 3, 5))
    return f"rgba({r}, {g}, {b}, {round(max(0.0, min(1.0, alpha)) * 255)})"


def card_qss(alpha: float) -> str:
    """Panel stylesheet; backgrounds and borders use `alpha`, text stays solid."""
    border = _rgba("#dadce0", min(1.0, alpha + 0.2))
    return f"""
#card {{
    background: {_rgba("#ffffff", alpha)}; border: 1px solid {border}; border-radius: 16px;
}}
#header {{
    background: {_rgba("#f8f9fa", alpha)}; border-bottom: 1px solid {border};
    border-top-left-radius: 16px; border-top-right-radius: 16px;
}}
#title {{ color: #5f6368; font-family: {FONT_FAMILY}; font-size: 10.5pt; font-weight: 500; }}
#status {{ color: #5f6368; font-family: {FONT_FAMILY}; font-size: 9pt; }}
#footer {{
    background: {_rgba("#f8f9fa", alpha)}; border-top: 1px solid {border};
    border-bottom-left-radius: 16px; border-bottom-right-radius: 16px;
}}
#hints {{ color: #80868b; font-family: {FONT_FAMILY}; font-size: 8pt; }}
#answer {{ border-bottom: 1px solid {_rgba("#f1f3f4", alpha)}; }}
QTextBrowser {{
    background: transparent; border: none; color: #3c4043;
    font-family: {FONT_FAMILY}; font-size: {BODY_PT}pt;
}}
"""



def menu_qss(alpha: float) -> str:
    return f"""
#menucard {{
    background: {_rgba("#ffffff", alpha)}; border: 1px solid {_rgba("#dadce0", min(1.0, alpha + 0.2))};
    border-radius: 12px;
}}
#menutitle {{ color: #5f6368; font-family: {FONT_FAMILY}; font-size: 9pt; font-weight: 500; }}
#menukey {{
    background: {_rgba("#e8f0fe", alpha)}; color: #1967d2; border-radius: 6px; padding: 2px 0;
    font-family: {FONT_FAMILY}; font-size: 10.5pt; font-weight: 700;
}}
#menulabel {{ color: #3c4043; font-family: {FONT_FAMILY}; font-size: 10.5pt; }}
"""


class Spinner(QWidget):
    """Blue arc spinner, like the userscript's loading spinner."""

    def __init__(self, parent: QWidget | None = None, size: int = 16):
        super().__init__(parent)
        self.setFixedSize(QSize(size, size))
        self._angle = 0
        self._timer = QTimer(self)
        self._timer.timeout.connect(self._tick)

    def start(self) -> None:
        self.show()
        self._timer.start(16)

    def stop(self) -> None:
        self._timer.stop()
        self.hide()

    def _tick(self) -> None:
        self._angle = (self._angle + 6) % 360
        self.update()

    def paintEvent(self, _event) -> None:  # noqa: N802 (Qt naming)
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        r = QRectF(2, 2, self.width() - 4, self.height() - 4)
        p.setPen(QPen(QColor("#e0e0e0"), 2.5))
        p.drawEllipse(r)
        p.setPen(QPen(QColor("#1a73e8"), 2.5, cap=Qt.PenCapStyle.RoundCap))
        p.drawArc(r, -self._angle * 16, 90 * 16)


class MathBrowser(QTextBrowser):
    """QTextBrowser that serves rendered formulas (ughmath:// URLs) from memory."""

    def __init__(self, parent: QWidget | None = None):
        super().__init__(parent)
        self.images: dict[str, QImage] = {}

    def loadResource(self, rtype: int, url: QUrl):  # noqa: N802 (Qt naming)
        if url.scheme() == "ughmath" and url.toString() in self.images:
            return self.images[url.toString()]
        return super().loadResource(rtype, url)


class Hud(QWidget):
    def __init__(self, hud_cfg: dict, hint_text: str):
        flags = (Qt.WindowType.FramelessWindowHint
                 | Qt.WindowType.WindowStaysOnTopHint
                 | Qt.WindowType.Tool                        # no taskbar button
                 | Qt.WindowType.WindowDoesNotAcceptFocus     # -> WS_EX_NOACTIVATE
                 | Qt.WindowType.WindowTransparentForInput)   # -> WS_EX_TRANSPARENT | WS_EX_LAYERED
        super().__init__(None, flags)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating)
        self.cfg = hud_cfg
        self._math_cache: dict[tuple, tuple[str, int, int]] = {}
        self._math_counter = 0

        card = QFrame(self)
        card.setObjectName("card")
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.addWidget(card)

        layout = QVBoxLayout(card)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        header = QFrame(card)
        header.setObjectName("header")
        hl = QHBoxLayout(header)
        hl.setContentsMargins(16, 10, 16, 10)
        title = QLabel("Gemini Assistant", header)
        title.setObjectName("title")
        self.spinner = Spinner(header)
        self.spinner.hide()
        self.status = QLabel("", header)
        self.status.setObjectName("status")
        hl.addWidget(title)
        hl.addStretch(1)
        hl.addWidget(self.status)
        hl.addSpacing(6)
        hl.addWidget(self.spinner)
        layout.addWidget(header)

        # Answer boxes: always fully visible, never scrolled.
        self.answer = MathBrowser(card)
        self.answer.setObjectName("answer")
        # Explanation (and status/error messages): scrolled from the menu.
        self.body = MathBrowser(card)
        for browser in (self.answer, self.body):
            browser.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
            browser.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
            browser.setOpenLinks(False)
            browser.document().setDocumentMargin(16)
        self.answer.images = self.body.images  # math images are shared
        self.answer.hide()
        layout.addWidget(self.answer)
        layout.addWidget(self.body, 1)

        footer = QFrame(card)
        footer.setObjectName("footer")
        fl = QHBoxLayout(footer)
        fl.setContentsMargins(16, 6, 16, 6)
        self.hints = QLabel(hint_text, footer)
        self.hints.setObjectName("hints")
        self.hints.setWordWrap(True)
        fl.addWidget(self.hints)
        layout.addWidget(footer)

        self._header = header
        self._footer = footer

        # Some fullscreen apps push themselves above other topmost windows; re-assert periodically.
        self._topmost_timer = QTimer(self)
        self._topmost_timer.timeout.connect(lambda: winapi.raise_topmost(int(self.winId())))
        self._topmost_timer.start(2000)

        self.apply_config(hud_cfg)

    # ------------------------------------------------------------------ window

    def apply_config(self, hud_cfg: dict) -> None:
        self.cfg = hud_cfg
        alpha = self.background_alpha()
        formatting.set_background_alpha(alpha)
        self.setStyleSheet(card_qss(alpha))
        self.setFixedWidth(int(hud_cfg.get("width", 420)))
        self._relayout()

    def background_alpha(self) -> float:
        return max(0.0, min(1.0, float(self.cfg.get("background_opacity", 0.6))))

    def showEvent(self, event) -> None:  # noqa: N802
        super().showEvent(event)
        hwnd = int(self.winId())
        winapi.apply_overlay_styles(hwnd, click_through=True)
        winapi.raise_topmost(hwnd)

    @staticmethod
    def _doc_height(browser: QTextBrowser, width: int) -> int:
        doc = browser.document()
        doc.setTextWidth(width)
        return int(doc.size().height()) + 1

    def _relayout(self) -> None:
        screen = QGuiApplication.primaryScreen().availableGeometry()
        text_w = self.width() - 2
        chrome_h = self._header.sizeHint().height() + self._footer.sizeHint().height() + 2
        max_h = int(screen.height() * float(self.cfg.get("max_height_ratio", 0.7)))

        answer_h = 0
        if not self.answer.isHidden():
            # Pinned, so it has to fit; leave at least a little room for the explanation.
            answer_h = min(self._doc_height(self.answer, text_w), max(60, max_h - chrome_h - 60))
            self.answer.setFixedHeight(answer_h)
        body_h = self._doc_height(self.body, text_w) if self.body.toPlainText().strip() else 0

        height = max(120, min(max_h, answer_h + body_h + chrome_h))
        self.setFixedHeight(height)

        margin = int(self.cfg.get("margin", 20))
        corner = self.cfg.get("corner", "top-right")
        x = screen.left() + margin if "left" in corner else screen.right() - self.width() - margin + 1
        y = screen.top() + margin if "top" in corner else screen.bottom() - height - margin + 1
        self.move(x, y)

    # ------------------------------------------------------------------ content

    def _add_math(self, tex: str, display: bool, color: str) -> str:
        scale = self.devicePixelRatioF() or 1.0
        key = (tex, display, color, scale)
        if key not in self._math_cache:
            # Formulas in the (larger) answer box are drawn at the answer box's font size.
            font_pt = ANSWER_PT if color == formatting.ANSWER_COLOR else BODY_PT
            png = formatting.render_tex_png(tex, display, color, font_pt, max(2.0, scale))
            if png is None:
                src = (r"\[" + tex + r"\]") if display else (r"\(" + tex + r"\)")
                return f'<span style="{formatting.code_style()}">{formatting.html.escape(src)}</span>'
            image = QImage.fromData(png, "PNG")
            self._math_counter += 1
            url = f"ughmath://{self._math_counter}.png"
            px_scale = max(2.0, scale)
            self._math_cache[key] = (url, round(image.width() / px_scale), round(image.height() / px_scale))
            self.body.images[url] = image
        url, w, h = self._math_cache[key]
        valign = "" if display else ' style="vertical-align: middle"'
        return f'<img src="{url}" width="{w}" height="{h}"{valign}>'

    @staticmethod
    def _set_vertical_margins(browser: QTextBrowser, top: int, bottom: int) -> None:
        root = browser.document().rootFrame()
        fmt = root.frameFormat()
        fmt.setTopMargin(top)
        fmt.setBottomMargin(bottom)
        root.setFrameFormat(fmt)

    def _set_html(self, html: str, keep_scroll: bool, answer_html: str | None = None) -> None:
        """Explanation/message into the scrolling body; answer boxes (if any) into the pinned area."""
        bar = self.body.verticalScrollBar()
        pos = bar.value()
        if answer_html is None:
            self.answer.hide()
            self.answer.clear()
        else:
            self.answer.setHtml(answer_html)
            self._set_vertical_margins(self.answer, 16, 6)
            self.answer.show()
        self.body.setHtml(html)
        self._set_vertical_margins(self.body, 6 if answer_html is not None else 16, 16)
        if keep_scroll:
            bar.setValue(pos)
        self._relayout()

    def clear(self) -> None:
        self.answer.clear()
        self.answer.hide()
        self.body.clear()

    def show_loading(self, status: str) -> None:
        self.status.setText(status)
        self.spinner.start()
        if not self.body.toPlainText().strip() or self.body.property("is_message"):
            self.body.setProperty("is_message", True)
            self._set_html(formatting.format_message(status, "#5f6368"), keep_scroll=False)

    def show_answer(self, raw: str, final: bool) -> None:
        self.body.setProperty("is_message", False)
        self.status.setText("Done" if final else "Answering...")
        if final:
            self.spinner.stop()
        else:
            self.spinner.start()
        answer_html, explanation_html = formatting.format_answer(raw, self._add_math)
        self._set_html(explanation_html, keep_scroll=True, answer_html=answer_html)

    def show_error(self, message: str) -> None:
        self.body.setProperty("is_message", True)
        self.status.setText("Error")
        self.spinner.stop()
        self._set_html(formatting.format_message(message, "#d93025"), keep_scroll=False)

    def show_message(self, message: str) -> None:
        self.body.setProperty("is_message", True)
        self.status.setText("")
        self.spinner.stop()
        self._set_html(formatting.format_message(message, "#5f6368"), keep_scroll=False)

    def scroll_by(self, pages: float) -> None:
        """Scrolls the explanation only; the answer boxes stay put."""
        bar = self.body.verticalScrollBar()
        bar.setValue(bar.value() + int(self.body.viewport().height() * pages))


class ActionMenu(QWidget):
    """The menu-key popup: a small numbered list next to the HUD. Click-through, never takes focus."""

    def __init__(self):
        flags = (Qt.WindowType.FramelessWindowHint
                 | Qt.WindowType.WindowStaysOnTopHint
                 | Qt.WindowType.Tool
                 | Qt.WindowType.WindowDoesNotAcceptFocus
                 | Qt.WindowType.WindowTransparentForInput)
        super().__init__(None, flags)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating)

        card = QFrame(self)
        card.setObjectName("menucard")
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.addWidget(card)
        self._layout = QVBoxLayout(card)
        self._layout.setContentsMargins(14, 10, 14, 12)
        self._layout.setSpacing(6)
        self._rows: list[QWidget] = []

    def set_items(self, title: str, items: list[tuple[str, str]]) -> None:
        for row in self._rows:
            self._layout.removeWidget(row)
            row.deleteLater()
        self._rows.clear()
        heading = QLabel(title)
        heading.setObjectName("menutitle")
        self._layout.addWidget(heading)
        self._rows.append(heading)
        for key, label in items:
            row = QWidget()
            rl = QHBoxLayout(row)
            rl.setContentsMargins(0, 0, 0, 0)
            rl.setSpacing(10)
            k = QLabel(key)
            k.setObjectName("menukey")
            k.setFixedWidth(22)
            k.setAlignment(Qt.AlignmentFlag.AlignCenter)
            t = QLabel(label)
            t.setObjectName("menulabel")
            rl.addWidget(k)
            rl.addWidget(t, 1)
            self._layout.addWidget(row)
            self._rows.append(row)
        self.adjustSize()

    def show_at(self, hud: Hud) -> None:
        """Beside the HUD (or in its corner when the HUD is hidden)."""
        self.setStyleSheet(menu_qss(hud.background_alpha()))
        self.adjustSize()
        screen = QGuiApplication.primaryScreen().availableGeometry()
        margin = int(hud.cfg.get("margin", 20))
        corner = hud.cfg.get("corner", "top-right")
        left = "left" in corner
        if hud.isVisible():
            x = hud.x() + hud.width() + 10 if left else hud.x() - self.width() - 10
        else:
            x = screen.left() + margin if left else screen.right() - self.width() - margin + 1
        y = screen.top() + margin if "top" in corner else screen.bottom() - self.height() - margin + 1
        self.move(x, y)
        self.show()
        winapi.raise_topmost(int(self.winId()))

    def showEvent(self, event) -> None:  # noqa: N802
        super().showEvent(event)
        winapi.apply_overlay_styles(int(self.winId()), click_through=True)
