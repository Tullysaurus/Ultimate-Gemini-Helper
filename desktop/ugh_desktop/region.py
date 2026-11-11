"""Drag-to-select overlay, styled like the userscript's Capture Area.

Shows the frozen screenshot (taken just before the overlay appears) dimmed over
the primary monitor; you drag a box and the matching part of the screenshot is
used. The window is WS_EX_NOACTIVATE: it receives the mouse but never takes
keyboard focus, so the app you were in stays focused. Esc is caught by the
global keyboard hook (see hotkeys.py) because the overlay never has focus.
"""

from __future__ import annotations

from PyQt6.QtCore import QPoint, QRect, QRectF, Qt, pyqtSignal
from PyQt6.QtGui import QColor, QFont, QGuiApplication, QImage, QPainter, QPen, QPixmap
from PyQt6.QtWidgets import QWidget

from . import winapi

MIN_SIZE = 8  # px; smaller drags count as a cancel


class RegionSelector(QWidget):
    selected = pyqtSignal(QImage)  # cropped screenshot
    cancelled = pyqtSignal()

    def __init__(self, screenshot: QImage):
        flags = (Qt.WindowType.FramelessWindowHint
                 | Qt.WindowType.WindowStaysOnTopHint
                 | Qt.WindowType.Tool
                 | Qt.WindowType.WindowDoesNotAcceptFocus)
        super().__init__(None, flags)
        self.setAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating)
        self.setAttribute(Qt.WidgetAttribute.WA_DeleteOnClose)
        self.setCursor(Qt.CursorShape.CrossCursor)
        self.setMouseTracking(True)

        self.screenshot = screenshot
        self.pixmap = QPixmap.fromImage(screenshot)
        self.setGeometry(QGuiApplication.primaryScreen().geometry())
        self._start: QPoint | None = None
        self._end: QPoint | None = None
        self._done = False

    def showEvent(self, event) -> None:  # noqa: N802
        super().showEvent(event)
        hwnd = int(self.winId())
        winapi.apply_overlay_styles(hwnd, click_through=False)
        winapi.raise_topmost(hwnd)

    # ------------------------------------------------------------------ result

    def _selection(self) -> QRect:
        if self._start is None or self._end is None:
            return QRect()
        # Width/height from the drag distance (QRect(p1, p2) would include both corners: +1px).
        x1, x2 = sorted((self._start.x(), self._end.x()))
        y1, y2 = sorted((self._start.y(), self._end.y()))
        return QRect(x1, y1, x2 - x1, y2 - y1)

    def finish(self, accept: bool) -> None:
        if self._done:
            return
        self._done = True
        rect = self._selection()
        self.hide()
        if accept and rect.width() >= MIN_SIZE and rect.height() >= MIN_SIZE:
            # Widget coords are logical pixels; the screenshot is physical pixels.
            sx = self.screenshot.width() / self.width()
            sy = self.screenshot.height() / self.height()
            crop = QRect(round(rect.x() * sx), round(rect.y() * sy), round(rect.width() * sx), round(rect.height() * sy))
            self.selected.emit(self.screenshot.copy(crop))
        else:
            self.cancelled.emit()
        self.close()

    # ------------------------------------------------------------------ input

    def mousePressEvent(self, e) -> None:  # noqa: N802
        if e.button() == Qt.MouseButton.LeftButton:
            self._start = self._end = e.position().toPoint()
            self.update()
        else:
            self.finish(accept=False)  # right/middle click cancels

    def mouseMoveEvent(self, e) -> None:  # noqa: N802
        if self._start is not None:
            self._end = e.position().toPoint()
            self.update()

    def mouseReleaseEvent(self, e) -> None:  # noqa: N802
        if e.button() == Qt.MouseButton.LeftButton and self._start is not None:
            self._end = e.position().toPoint()
            self.finish(accept=True)

    # ------------------------------------------------------------------ paint

    def paintEvent(self, _event) -> None:  # noqa: N802
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        full = self.rect()
        p.drawPixmap(full, self.pixmap)
        sel = self._selection()

        dim = QColor(0, 0, 0, 64)  # rgba(0,0,0,0.25) like the userscript
        if sel.isNull():
            p.fillRect(full, dim)
        else:
            # Dim everything except the selection.
            p.fillRect(QRect(full.left(), full.top(), full.width(), sel.top() - full.top()), dim)
            p.fillRect(QRect(full.left(), sel.bottom() + 1, full.width(), full.bottom() - sel.bottom()), dim)
            p.fillRect(QRect(full.left(), sel.top(), sel.left() - full.left(), sel.height()), dim)
            p.fillRect(QRect(sel.right() + 1, sel.top(), full.right() - sel.right(), sel.height()), dim)
            p.fillRect(sel, QColor(26, 115, 232, 20))
            p.setPen(QPen(QColor("#1a73e8"), 2))
            p.drawRect(sel.adjusted(0, 0, -1, -1))

        if self._start is None:
            text = "Drag to select an area  ·  Esc or right-click to cancel"
            font = QFont("Segoe UI", 10)
            font.setWeight(QFont.Weight.Medium)
            p.setFont(font)
            w = p.fontMetrics().horizontalAdvance(text) + 28
            box = QRectF(full.center().x() - w / 2, 16, w, 34)
            p.setPen(Qt.PenStyle.NoPen)
            p.setBrush(QColor("#202124"))
            p.drawRoundedRect(box, 8, 8)
            p.setPen(QColor("#ffffff"))
            p.drawText(box, Qt.AlignmentFlag.AlignCenter, text)
