"""Global Ctrl+Alt hotkeys via low-level keyboard/mouse hooks, forwarded to the Qt thread as signals.

  * Ctrl+Alt+W / S / Up / Down trigger actions while hotkeys are enabled.
  * Ctrl+Alt+D toggles enabled/disabled (which also opens/closes the HUD) and always works.
  * Esc is consumed while the region selector is open.

Nothing of a hotkey reaches the app you're in, not even Ctrl and Alt: while hotkeys are
enabled, Ctrl/Alt presses are held back until we know whether a hotkey follows.

  * A hotkey key follows -> it's consumed, and so are the held-back Ctrl/Alt (down and up).
  * Anything else follows (another key, a mouse click or wheel) -> the held-back Ctrl/Alt
    presses are re-sent first, then that key/click, so Ctrl+Z, Ctrl+click etc. work as usual.
  * Ctrl/Alt released with nothing in between -> the press and release are re-sent.

Ctrl/Alt pressed while Shift or Win is already down, or while hotkeys are disabled, aren't
held back. AltGr (which Windows reports as Ctrl + Right Alt) is never held back or treated
as Ctrl+Alt.

The hook runs on its own thread and must decide synchronously whether to block each event,
so all this state lives here rather than on the Qt thread.
"""

from __future__ import annotations

import threading
import time

from PyQt6.QtCore import QObject, pyqtSignal

from . import llhook, winapi

VK_CTRL = frozenset({0x11, 0xA2, 0xA3})  # generic, left, right
VK_ALT = frozenset({0x12, 0xA4, 0xA5})
VK_RALT = 0xA5
VK_SHIFT, VK_LWIN, VK_RWIN = 0x10, 0x5B, 0x5C
VK_ESC = 0x1B
VK_TOGGLE = 0x44  # D
ALTGR_FAKE_CTRL_SCAN = 0x21D  # the synthetic Left Ctrl that AltGr layouts send before Right Alt

# Virtual-key code -> action name (App method).
ACTION_KEYS = {
    0x57: "capture_screen",  # W
    0x53: "capture_region",  # S
    0x26: "scroll_up",       # Up
    0x28: "scroll_down",     # Down
}
REPEATABLE = frozenset({"scroll_up", "scroll_down"})  # holding the key keeps firing

# Safety net for key-ups that never arrive (e.g. focus in an elevated app): a held key keeps
# auto-repeating, so this long with no keyboard events at all means our state is stale.
STALE_SECONDS = 10

HINT_TEXT = "Ctrl+Alt + W screen · S region · ↑/↓ scroll · D on/off"


class HotkeyManager(QObject):
    # All emitted from the hook thread, delivered on the Qt thread (queued, in order).
    action = pyqtSignal(str)          # one of ACTION_KEYS' values
    enabled_changed = pyqtSignal(bool)
    escape = pyqtSignal()             # Esc while the region selector is open

    def __init__(self, send=None) -> None:
        super().__init__()
        self._send = send or llhook.send  # injectable for tests
        self._lock = threading.Lock()
        self._hooks: llhook.LowLevelHooks | None = None
        self._enabled = True
        self._grab_escape = False
        self._held: set[int] = set()  # keys whose down we consumed: consume their repeats/up too
        # Physically held Ctrl/Alt keys -> (scan, extended) while held back, None once sent on.
        self._mods: dict[int, tuple[int, bool] | None] = {}
        self._used = False    # a hotkey fired while these modifiers were held: swallow held-back ups
        self._altgr = False
        self._last_event = 0.0

    # ------------------------------------------------------------------ setup

    def start(self) -> None:
        if self._hooks is None:
            self._hooks = llhook.LowLevelHooks(self._on_key, self._on_mouse, self._reset)
            self._hooks.start()

    def stop(self) -> None:
        if self._hooks is not None:
            self._hooks.stop()
            self._hooks = None

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

    # ------------------------------------------------------------------ helpers (hook thread, lock held)

    def _reset(self) -> None:
        """Forget held keys (desktop switch: Ctrl+Alt+Del, lock screen, UAC swallow the key-ups)."""
        with self._lock:
            self._reset_locked()

    def _reset_locked(self) -> None:
        self._mods.clear()
        self._held.clear()
        self._used = False
        self._altgr = False

    def _ctrl_alt(self) -> bool:
        return any(vk in VK_CTRL for vk in self._mods) and any(vk in VK_ALT for vk in self._mods)

    def _holding_back(self) -> bool:
        return any(ev is not None for ev in self._mods.values())

    def _release_inputs(self) -> list:
        """Key-downs for the held-back modifiers (in press order); marks them as sent."""
        out = []
        for vk, ev in self._mods.items():
            if ev is not None:
                out.append(llhook.key_input(vk, ev[0], ev[1], up=False))
                self._mods[vk] = None
        return out

    # ------------------------------------------------------------------ hooks (hook thread)

    def _on_mouse(self, replay) -> bool:
        """Button/wheel event. Returns False to block it."""
        with self._lock:
            if not self._holding_back():
                return True
            # Ctrl+click, Ctrl+wheel...: send the modifiers first, then the event itself.
            self._send(self._release_inputs() + [replay])
            return False

    def _on_key(self, vk: int, scan: int, extended: bool, down: bool) -> bool:
        """Returns False to block the key from reaching other apps."""
        with self._lock:
            now = time.monotonic()
            if (self._mods or self._held) and now - self._last_event > STALE_SECONDS:
                self._reset_locked()
            self._last_event = now

            # AltGr = synthetic Left Ctrl + Right Alt: pass both straight through.
            if scan == ALTGR_FAKE_CTRL_SCAN or (vk == VK_RALT and self._altgr):
                if scan == ALTGR_FAKE_CTRL_SCAN:
                    self._altgr = down
                if self._holding_back():
                    self._send(self._release_inputs())
                return True

            if vk in VK_CTRL or vk in VK_ALT:
                return self._on_modifier(vk, scan, extended, down)

            if not down:
                if vk in self._held:
                    self._held.discard(vk)
                    return False
                return True

            if vk in self._held:  # auto-repeat of a key we consumed
                action = ACTION_KEYS.get(vk)
                if self._enabled and action in REPEATABLE and self._ctrl_alt():
                    self.action.emit(action)
                return False

            if vk == VK_ESC and self._grab_escape:
                self._held.add(vk)
                self.escape.emit()
                return False

            if self._ctrl_alt():
                if vk == VK_TOGGLE:
                    self._held.add(vk)
                    self._used = True
                    self._enabled = not self._enabled
                    self.enabled_changed.emit(self._enabled)
                    return False
                if self._enabled and vk in ACTION_KEYS:
                    self._held.add(vk)
                    self._used = True
                    self.action.emit(ACTION_KEYS[vk])
                    return False

            if self._holding_back():
                # Not a hotkey: send the held-back modifiers, then this key, in that order.
                self._send(self._release_inputs() + [llhook.key_input(vk, scan, extended, up=False)])
                return False
            return True

    def _on_modifier(self, vk: int, scan: int, extended: bool, down: bool) -> bool:
        if down:
            if vk in self._mods:  # auto-repeat: block it only while the press is held back
                return self._mods[vk] is None
            if (not self._enabled or winapi.key_down(VK_SHIFT)
                    or winapi.key_down(VK_LWIN) or winapi.key_down(VK_RWIN)):
                self._mods[vk] = None  # tracked for hotkey matching, but not held back
                return True
            self._mods[vk] = (scan, extended)
            return False

        if vk not in self._mods:
            return True
        result = True
        if self._mods[vk] is not None:  # released while held back
            if not self._used:
                # A plain tap (e.g. Alt for the menu bar): send it after all, press then release.
                self._send(self._release_inputs() + [llhook.key_input(vk, scan, extended, up=True)])
            result = False
        del self._mods[vk]
        if not self._mods:
            self._used = False
        return result
