"""Screen capture with mss (GDI BitBlt: no OS capture UI, no sound, no permission prompt)."""

from __future__ import annotations

import mss
from PyQt6.QtCore import QBuffer, QIODevice, Qt
from PyQt6.QtGui import QImage


def _primary_monitor(sct: mss.base.MSSBase) -> dict:
    # On Windows the primary monitor is the one whose top-left corner is (0, 0).
    for mon in sct.monitors[1:]:
        if mon["left"] == 0 and mon["top"] == 0:
            return mon
    return sct.monitors[1]


def grab_primary() -> QImage:
    """Full-resolution screenshot of the primary monitor (physical pixels)."""
    with mss.mss() as sct:
        shot = sct.grab(_primary_monitor(sct))
        # mss returns BGRA, which is QImage.Format_RGB32 on little-endian machines.
        image = QImage(shot.bgra, shot.width, shot.height, shot.width * 4, QImage.Format.Format_RGB32)
        return image.copy()  # detach from mss's buffer


def to_png(image: QImage, max_side: int) -> bytes:
    """PNG bytes, downscaled so the longest side is at most max_side (keeps uploads small)."""
    if max_side and max(image.width(), image.height()) > max_side:
        image = image.scaled(max_side, max_side, Qt.AspectRatioMode.KeepAspectRatio,
                             Qt.TransformationMode.SmoothTransformation)
    buf = QBuffer()
    buf.open(QIODevice.OpenModeFlag.WriteOnly)
    image.save(buf, "PNG")
    return bytes(buf.data())
