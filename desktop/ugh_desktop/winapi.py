"""Windows API helpers (ctypes): non-activating, click-through, always-on-top windows."""

from __future__ import annotations

import ctypes
import sys
from ctypes import wintypes

IS_WINDOWS = sys.platform == "win32"

GWL_EXSTYLE = -20
WS_EX_TOPMOST = 0x00000008
WS_EX_TRANSPARENT = 0x00000020      # mouse input passes through (with WS_EX_LAYERED)
WS_EX_TOOLWINDOW = 0x00000080       # no taskbar button / Alt+Tab entry
WS_EX_LAYERED = 0x00080000
WS_EX_NOACTIVATE = 0x08000000       # never becomes the foreground window / takes keyboard focus

SWP_NOSIZE = 0x0001
SWP_NOMOVE = 0x0002
SWP_NOACTIVATE = 0x0010
SWP_NOOWNERZORDER = 0x0200
HWND_TOPMOST = -1

if IS_WINDOWS:
    _user32 = ctypes.WinDLL("user32", use_last_error=True)
    if ctypes.sizeof(ctypes.c_void_p) == 8:
        _get_long = _user32.GetWindowLongPtrW
        _set_long = _user32.SetWindowLongPtrW
    else:
        _get_long = _user32.GetWindowLongW
        _set_long = _user32.SetWindowLongW
    _get_long.argtypes = [wintypes.HWND, ctypes.c_int]
    _get_long.restype = ctypes.c_ssize_t
    _set_long.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_ssize_t]
    _set_long.restype = ctypes.c_ssize_t
    _set_pos = _user32.SetWindowPos
    _set_pos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT]
    _set_pos.restype = wintypes.BOOL
    _get_foreground = _user32.GetForegroundWindow
    _get_foreground.restype = wintypes.HWND
    _get_async_key_state = _user32.GetAsyncKeyState
    _get_async_key_state.argtypes = [ctypes.c_int]
    _get_async_key_state.restype = ctypes.c_short


def get_ex_style(hwnd: int) -> int:
    return int(_get_long(hwnd, GWL_EXSTYLE)) if IS_WINDOWS else 0


def apply_overlay_styles(hwnd: int, click_through: bool) -> int:
    """Adds WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW (+ WS_EX_TRANSPARENT if click_through).

    WS_EX_LAYERED is left to Qt: Qt sets it for translucent / transparent-for-input
    windows and draws them with UpdateLayeredWindow; changing it here would break that.
    Returns the resulting extended style.
    """
    if not IS_WINDOWS:
        return 0
    style = get_ex_style(hwnd)
    wanted = style | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW
    if click_through:
        wanted |= WS_EX_TRANSPARENT
    if wanted != style:
        _set_long(hwnd, GWL_EXSTYLE, wanted)
    return get_ex_style(hwnd)


def raise_topmost(hwnd: int) -> None:
    """Re-asserts HWND_TOPMOST without activating (some fullscreen apps push themselves on top)."""
    if IS_WINDOWS:
        _set_pos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER)


def foreground_window() -> int:
    return int(_get_foreground() or 0) if IS_WINDOWS else 0


def key_down(vk: int) -> bool:
    """True if the key is held right now (as far as apps can tell: keys our hook blocked don't count)."""
    return IS_WINDOWS and bool(_get_async_key_state(vk) & 0x8000)
