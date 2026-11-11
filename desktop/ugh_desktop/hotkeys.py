"""Global Ctrl+Alt hotkeys via one low-level `keyboard` hook, forwarded to the Qt thread as signals.

  * Ctrl+Alt+S / P / H / Up / Down trigger actions while hotkeys are enabled.
    The action key is consumed (down, auto-repeat and up), so it never reaches
    the app you're in. While disabled, those combos pass through untouched.
  * Ctrl+Alt+D toggles enabled/disabled and is always consumed.
  * Esc is consumed while the region selector is open.

Ctrl and Alt themselves are never blocked: the hook can't know a combo is coming
when they go down, and swallowing them would break every other shortcut.

The modifier state is read with GetAsyncKeyState instead of being tracked from
hook events, so a missed key-up (e.g. after Win+L) can't leave Ctrl/Alt "stuck"
and turn plain S/P/H presses into captures.

The hook runs on keyboard's hook thread and must decide synchronously whether
to block each key, so the enabled state lives here rather than on the Qt thread.
"""

from __future__ import annotations

import threading

import keyboard
from PyQt6.QtCore import QObject, pyqtSignal

from . import winapi

# Key name (as reported by `keyboard`) -> action name.
ACTION_KEYS = {
    "s": "capture_region",
    "w": "capture_screen",
    "h": "toggle_hud",
    "up": "scroll_up",
    "down": "scroll_down",
}
TOGGLE_KEY = "d"
REPEATABLE = frozenset({"scroll_up", "scroll_down"})  # holding the key keeps firing

HINT_TEXT = "Ctrl+Alt + W screen · S region · H hide · ↑/↓ scroll · D on/off"


class HotkeyManager(QObject):
    # All emitted from keyboard's hook thread, delivered on the Qt thread (queued, in order).
    action = pyqtSignal(str)          # one of ACTION_KEYS' values
    enabled_changed = pyqtSignal(bool)
    escape = pyqtSignal()             # Esc while the region selector is open

    def __init__(self) -> None:
        super().__init__()
        self._lock = threading.Lock()
        self._remove_hook = None
        self._enabled = True
        self._grab_escape = False
        self._held: set[int] = set()  # scan codes whose key-down we consumed: consume their repeats/up too
        # Matched by scan code: under Ctrl+Alt (= AltGr on Windows) `keyboard` may report odd key names.
        self._actions: dict[int, str] = {}
        self._toggle_codes: frozenset[int] = frozenset()
        self._esc_codes: frozenset[int] = frozenset()

    # ------------------------------------------------------------------ setup

    def start(self) -> None:
        with self._lock:
            self._actions = {code: action for key, action in ACTION_KEYS.items() for code in _codes(key)}
            self._toggle_codes = _codes(TOGGLE_KEY)
            self._esc_codes = _codes("esc")
        if self._remove_hook is None:
            self._remove_hook = keyboard.hook(self._on_key, suppress=True)

    def stop(self) -> None:
        if self._remove_hook is not None:
            try:
                self._remove_hook()
            except (KeyError, ValueError):
                pass
            self._remove_hook = None

    # ------------------------------------------------------------------ state (called from the Qt thread)

    @property
    def enabled(self) -> bool:
        return self._enabled

    def set_enabled(self, on: bool) -> None:
        with self._lock:
            changed, self._enabled = self._enabled != on, on
        if changed:
            self.enabled_changed.emit(on)

    def set_grab_escape(self, on: bool) -> None:
        with self._lock:
            self._grab_escape = on

    # ------------------------------------------------------------------ hook (keyboard's thread)

    def _on_key(self, event: keyboard.KeyboardEvent) -> bool:
        """Returns False to block the key from reaching other apps."""
        code = abs(event.scan_code or 0)

        with self._lock:
            if event.event_type == keyboard.KEY_UP:
                if code in self._held:
                    self._held.discard(code)
                    return False
                return True

            repeat = code in self._held
            if repeat:
                # Keep consuming a key we grabbed, even if Ctrl/Alt were released mid-hold.
                action = self._actions.get(code)
                if self._enabled and action in REPEATABLE and winapi.ctrl_alt_down():
                    self.action.emit(action)
                return False

            if code in self._esc_codes and self._grab_escape:
                self._held.add(code)
                self.escape.emit()
                return False

            if not winapi.ctrl_alt_down():
                return True

            if code in self._toggle_codes:
                self._held.add(code)
                self._enabled = not self._enabled
                self.enabled_changed.emit(self._enabled)
                return False

            if self._enabled and code in self._actions:
                self._held.add(code)
                self.action.emit(self._actions[code])
                return False

        return True


def _codes(key: str) -> frozenset[int]:
    """The key's primary scan code in the current layout (later entries are e.g. media keys)."""
    return frozenset({abs(keyboard.key_to_scan_codes(key)[0])})
