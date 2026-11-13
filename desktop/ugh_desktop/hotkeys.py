"""Global keys via one low-level `keyboard` hook, forwarded to the Qt thread as signals.

Everything goes through a single menu key (F9 by default):

  * The menu key itself is always consumed (down, auto-repeat and up), so it
    never reaches the app you're in.
  * While the menu is open, digit keys (top row and numpad) and the navigation
    keys (arrows, Page Up/Down, Home/End, Backspace) are consumed too and become
    menu choices. While it's closed, they all pass through untouched.
  * Pressing the menu key twice quickly (a double tap) closes the menu again and
    emits `quick` instead (the app repeats the last capture).
  * Esc is consumed while the menu or the region selector is open.

The hook runs on keyboard's hook thread and must decide synchronously whether
to block each key, so the open/closed state lives here rather than on the Qt
thread (a fast "F9 then 1" can't slip a digit through before Qt catches up).
"""

from __future__ import annotations

import threading
import time

import keyboard
from PyQt6.QtCore import QObject, pyqtSignal

DIGITS = frozenset("0123456789")
NAV_KEYS = frozenset({"up", "down", "page up", "page down", "home", "end", "backspace"})
MENU_KEYS = DIGITS | NAV_KEYS  # key names (as `keyboard` reports them) that are menu choices


class HotkeyManager(QObject):
    # All emitted from keyboard's hook thread, delivered on the Qt thread (queued, in order).
    menu_changed = pyqtSignal(bool)  # menu opened (True) / closed (False)
    choice = pyqtSignal(str, bool)   # menu key name (digit / "up" / ...) pressed while the menu was open, is_repeat
    quick = pyqtSignal()             # menu key double-tapped
    escape = pyqtSignal()            # Esc while the region selector is open

    def __init__(self) -> None:
        super().__init__()
        self._lock = threading.Lock()
        self._remove_hook = None
        self._menu_codes: frozenset[int] = frozenset()
        self._sticky: frozenset[str] = frozenset()  # choices that keep the menu open (e.g. scrolling)
        self._menu_open = False
        self._opened_at = 0.0         # time.monotonic() of the last menu open, for double-tap detection
        self._double_tap = 0.0        # seconds; 0 disables the double tap
        self._grab_escape = False
        self._held: set[int] = set()  # scan codes whose key-down we consumed: consume their repeats/up too

    # ------------------------------------------------------------------ setup

    def start(self, menu_key: str, sticky_choices: set[str], double_tap_ms: float = 0) -> str | None:
        """(Re)installs the hook. Returns an error message if the menu key is invalid."""
        error = None
        try:
            codes = frozenset(abs(c) for c in keyboard.key_to_scan_codes(menu_key))
        except (ValueError, TypeError) as exc:
            error = f"Menu key '{menu_key}' isn't valid ({exc}). Using F9 instead."
            codes = frozenset(abs(c) for c in keyboard.key_to_scan_codes("f9"))
        with self._lock:
            self._menu_codes = codes
            self._sticky = frozenset(sticky_choices)
            self._double_tap = max(0.0, float(double_tap_ms or 0)) / 1000
        if self._remove_hook is None:
            self._remove_hook = keyboard.hook(self._on_key, suppress=True)
        return error

    def stop(self) -> None:
        if self._remove_hook is not None:
            try:
                self._remove_hook()
            except (KeyError, ValueError):
                pass
            self._remove_hook = None

    # ------------------------------------------------------------------ state (called from the Qt thread)

    @property
    def menu_open(self) -> bool:
        return self._menu_open

    def close_menu(self) -> None:
        with self._lock:
            was_open, self._menu_open = self._menu_open, False
        if was_open:
            self.menu_changed.emit(False)

    def set_grab_escape(self, on: bool) -> None:
        with self._lock:
            self._grab_escape = on

    # ------------------------------------------------------------------ hook (keyboard's thread)

    def _on_key(self, event: keyboard.KeyboardEvent) -> bool:
        """Returns False to block the key from reaching other apps."""
        code = abs(event.scan_code or 0)
        name = (event.name or "").lower()

        with self._lock:
            if event.event_type == keyboard.KEY_UP:
                if code in self._held:
                    self._held.discard(code)
                    return False
                return True

            repeat = code in self._held

            if code in self._menu_codes:
                self._held.add(code)
                if not repeat:  # holding the key doesn't flicker the menu
                    now = time.monotonic()
                    double = self._menu_open and now - self._opened_at < self._double_tap
                    self._menu_open = not self._menu_open
                    if self._menu_open:
                        self._opened_at = now
                    self.menu_changed.emit(self._menu_open)
                    if double:
                        self.quick.emit()
                return False

            if name in MENU_KEYS and (self._menu_open or repeat):
                self._held.add(code)
                if self._menu_open:
                    if name not in self._sticky:
                        self._menu_open = False
                        self.menu_changed.emit(False)
                    self.choice.emit(name, repeat)
                return False

            if name == "esc" and (self._menu_open or self._grab_escape or repeat):
                self._held.add(code)
                if self._menu_open:
                    self._menu_open = False
                    self.menu_changed.emit(False)
                elif self._grab_escape and not repeat:
                    self.escape.emit()
                return False

        return True


def pretty(combo: str) -> str:
    return "+".join(part.strip().capitalize() for part in combo.split("+")) if combo else ""
