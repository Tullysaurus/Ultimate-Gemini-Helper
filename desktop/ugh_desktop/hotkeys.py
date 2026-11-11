"""Global hotkeys via the `keyboard` package, forwarded to the Qt thread as signals.

Hotkeys are registered with suppress=True: the key combination is consumed and
doesn't also reach the app you're in, so it can't trigger that app's shortcuts.
"""

from __future__ import annotations

import keyboard
from PyQt6.QtCore import QObject, pyqtSignal


class HotkeyManager(QObject):
    triggered = pyqtSignal(str)  # action name; emitted from keyboard's hook thread, delivered on the Qt thread

    def __init__(self) -> None:
        super().__init__()
        self._handles: dict[str, object] = {}
        self._temporary: dict[str, object] = {}

    def register(self, mapping: dict[str, str]) -> list[str]:
        """(Re)registers all hotkeys. Returns error messages for combos that failed."""
        self.unregister_all()
        errors = []
        for action, combo in mapping.items():
            if not combo:
                continue
            try:
                self._handles[action] = keyboard.add_hotkey(
                    combo, lambda a=action: self.triggered.emit(a), suppress=True, trigger_on_release=False)
            except (ValueError, ImportError) as exc:
                errors.append(f"{action} ({combo}): {exc}")
        return errors

    def add_temporary(self, name: str, combo: str) -> None:
        """Extra hotkey active only for a while (e.g. Esc while the region selector is open)."""
        self.remove_temporary(name)
        self._temporary[name] = keyboard.add_hotkey(combo, lambda: self.triggered.emit(name), suppress=True)

    def remove_temporary(self, name: str) -> None:
        handle = self._temporary.pop(name, None)
        if handle is not None:
            try:
                keyboard.remove_hotkey(handle)
            except (KeyError, ValueError):
                pass

    def unregister_all(self) -> None:
        for handle in list(self._handles.values()) + list(self._temporary.values()):
            try:
                keyboard.remove_hotkey(handle)
            except (KeyError, ValueError):
                pass
        self._handles.clear()
        self._temporary.clear()


def pretty(combo: str) -> str:
    return "+".join(part.strip().capitalize() for part in combo.split("+")) if combo else ""
