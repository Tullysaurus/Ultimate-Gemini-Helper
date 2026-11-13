"""Application wiring: tray icon, menu key, capture -> AI -> HUD."""

from __future__ import annotations

import os
import sys

from PyQt6.QtCore import QLockFile, QObject, QRect, QTimer, pyqtSignal
from PyQt6.QtGui import QImage
from PyQt6.QtWidgets import QApplication, QInputDialog, QLineEdit, QMenu, QMessageBox, QSystemTrayIcon

from . import ai, capture, config, formatting, tools
from .hotkeys import HotkeyManager, pretty
from .hud import ActionMenu, Hud, StatusDot
from .icons import app_icon
from .region import RegionSelector

HIDE_BEFORE_CAPTURE_MS = 80  # give the compositor time to remove the HUD/menu/dot before grabbing
ARROW_SCROLL_PAGES = 0.25    # per arrow press (holding repeats)
PAGE_SCROLL_PAGES = 0.9      # Page Up / Page Down
SCROLL_MODE_SECONDS = 10     # the menu stays open at least this long after a scroll

# Menu choices: key name (as the hotkey hook reports it) -> App method. "0" (and Esc / the menu key) cancels.
MENU_CHOICES = {
    "1": "capture_screen",
    "2": "capture_region",
    "3": "recapture_region",
    "4": "retry",
    "5": "copy_answer",
    "6": "toggle_answer",
    "9": "toggle_enabled",
    "up": "scroll_up",
    "down": "scroll_down",
    "page up": "page_up",
    "page down": "page_down",
    "home": "scroll_top",
    "end": "scroll_bottom",
    "backspace": "stop",
}
STICKY_CHOICES = {"up", "down", "page up", "page down", "home", "end"}  # scrolling keeps the menu open
DISABLED_CHOICES = {"9"}  # the only choice that works while disabled (re-enables)


class Bridge(QObject):
    """Carries worker-thread callbacks onto the Qt thread. Each carries the job id."""
    status = pyqtSignal(int, str)
    progress = pyqtSignal(int, str)
    thinking = pyqtSignal(int, str, int)
    tools = pyqtSignal(int, object)  # list of tool-call entries
    done = pyqtSignal(int, str)
    error = pyqtSignal(int, str)


class App(QObject):
    def __init__(self, qapp: QApplication):
        super().__init__()
        self.qapp = qapp
        self.cfg = config.load_config()
        self.job: ai.AnalysisJob | None = None
        self.job_id = 0
        self.selector: RegionSelector | None = None
        self.enabled = True         # disabled = HUD hidden and menu choices off (except 9 to re-enable)
        self.answer_hidden = False  # answer panel hidden with 6; the app stays enabled
        self.busy_capturing = False
        self.scroll_mode = False    # menu shrunk to the scrolling reminder strip
        self.last_image: QImage | None = None  # last image sent, for retry
        self.last_region: QRect | None = None  # last region box (screenshot pixels), for recapture
        self.last_capture = "capture_screen"   # what a double tap of the menu key repeats
        self.last_raw = ""                     # last answer text (possibly partial), for copy

        self.bridge = Bridge()
        self.bridge.status.connect(self._on_status)
        self.bridge.progress.connect(self._on_progress)
        self.bridge.thinking.connect(self._on_thinking)
        self.bridge.tools.connect(self._on_tools)
        self.bridge.done.connect(self._on_done)
        self.bridge.error.connect(self._on_error)

        self.hud = Hud(self.cfg["hud"], self._hint_text())
        self.menu = ActionMenu()
        self.dot = StatusDot()  # enabled/disabled; never hidden except for the instant of a capture
        self.menu_timer = QTimer(self)
        self.menu_timer.setSingleShot(True)
        self.menu_timer.timeout.connect(lambda: self.hotkeys.close_menu())
        self.hotkeys = HotkeyManager()
        self.hotkeys.menu_changed.connect(self._on_menu_changed)
        self.hotkeys.choice.connect(self._on_choice)
        self.hotkeys.quick.connect(self._on_quick)
        self.hotkeys.escape.connect(lambda: self.selector and self.selector.finish(accept=False))
        self._register_hotkeys()

        self.tray = QSystemTrayIcon(app_icon(), self)
        self.tray.setToolTip("UGH Desktop")
        self.tray.setContextMenu(self._build_menu())
        self.tray.show()

        if config.get_api_key():
            self.hud.show_message(f"Ready. {self._hint_text()}")
        else:
            self.hud.show_message("No OpenRouter API key yet. Right-click the UGH tray icon → Set API key… "
                                  "(get one at openrouter.ai/keys).")
        self.hud.show()
        self.dot.place()
        self.dot.show()
        if self.cfg.get("tools", True):
            QTimer.singleShot(1500, tools.prewarm)  # start the calculator process once the UI is up

    # ------------------------------------------------------------------ setup

    def _menu_key_label(self) -> str:
        return pretty(self.cfg.get("menu_key") or "f9")

    def _hint_text(self) -> str:
        key = self._menu_key_label()
        return f"{key}: menu · {key} twice: repeat last capture"

    def _register_hotkeys(self) -> None:
        error = self.hotkeys.start(self.cfg.get("menu_key") or "f9", STICKY_CHOICES,
                                   self.cfg.get("double_tap_ms", 350))
        if error:
            self.cfg["menu_key"] = "f9"
            QMessageBox.warning(None, "UGH Desktop", error)

    def _build_menu(self) -> QMenu:
        menu = QMenu()
        key = self._menu_key_label()
        menu.addAction(f"Capture screen\t{key}, 1", self.capture_screen)
        menu.addAction(f"Capture region\t{key}, 2", self.capture_region)
        menu.addAction(f"Recapture last region\t{key}, 3", self.recapture_region)
        menu.addAction(f"Retry last image\t{key}, 4", self.retry)
        menu.addAction(f"Copy answer\t{key}, 5", self.copy_answer)
        menu.addAction(f"Hide / show answer\t{key}, 6", self.toggle_answer)
        self.enabled_action = menu.addAction(f"Enabled\t{key}, 9")
        self.enabled_action.setCheckable(True)
        self.enabled_action.setChecked(self.enabled)
        self.enabled_action.triggered.connect(self.set_enabled)
        menu.addSeparator()
        menu.addAction("Set API key…", self.set_api_key)
        menu.addAction("Open settings file", lambda: os.startfile(config.config_path()))  # noqa: S606
        menu.addAction("Reload settings", self.reload_settings)
        menu.addSeparator()
        menu.addAction("Quit", self.quit)
        return menu

    # ------------------------------------------------------------------ menu

    def _available(self, key: str) -> bool:
        if not self.enabled:
            return key in DISABLED_CHOICES
        if key == "3":
            return self.last_region is not None
        if key == "4":
            return self.last_image is not None
        if key == "5":
            return bool(formatting.parse_answers(self.last_raw))
        if key == "backspace":
            return self.job is not None
        return True

    def _menu_items(self) -> list[tuple[str, str, bool]]:
        if not self.enabled:
            return [("9", "Enable and show", True), ("0", "Cancel", True)]
        items = [
            ("1", "Capture full screen", True),
            ("2", "Capture region", True),
            ("3", "Recapture last region", self._available("3")),
            ("4", "Retry last image", self._available("4")),
            ("5", "Copy answer", self._available("5")),
            ("6", "Show answer" if self.answer_hidden else "Hide answer", True),
            ("↑↓", "Scroll  (PgUp/PgDn, Home/End)", True),
        ]
        if self.job is not None:
            items.append(("⌫", "Stop answering", True))
        items += [("9", "Disable and hide", True), ("0", "Cancel", True)]
        return items

    def _on_menu_changed(self, is_open: bool) -> None:
        self.scroll_mode = False
        if not is_open:
            self.menu_timer.stop()
            self.menu.hide()
            return
        self.menu.set_items(f"UGH · press a key ({self._menu_key_label()} or 0 to close)", self._menu_items())
        self.menu.show_at(self.hud)
        self._restart_menu_timer()

    def _restart_menu_timer(self) -> None:
        seconds = float(self.cfg.get("menu_timeout_seconds", 5) or 0)
        if seconds > 0:
            if self.scroll_mode:
                seconds = max(seconds, SCROLL_MODE_SECONDS)
            self.menu_timer.start(int(seconds * 1000))

    def _enter_scroll_mode(self) -> None:
        """After the first scroll the menu shrinks to a reminder strip and stays open longer."""
        if self.scroll_mode or not self.hotkeys.menu_open:
            return
        self.scroll_mode = True
        self.menu.set_items("Scrolling · Esc or 0 when done", [
            ("↑↓", "Scroll"),
            ("PgUp/Dn", "Page"),
            ("Home/End", "Top / bottom"),
        ])
        self.menu.show_at(self.hud)

    def _on_choice(self, key: str, repeat: bool) -> None:
        action = MENU_CHOICES.get(key)
        if action is None or not self._available(key):
            return  # 0 / unused or unavailable key: nothing to do
        if key in STICKY_CHOICES:
            self._restart_menu_timer()  # holding an arrow auto-repeats the scroll
        elif repeat:
            return
        getattr(self, action)()
        if key in STICKY_CHOICES:
            self._enter_scroll_mode()  # after scrolling, so a revealed HUD is where the strip goes

    def _on_quick(self) -> None:
        """Menu key double-tapped: repeat the last capture (full screen until there's been another)."""
        if self.enabled:
            getattr(self, self.last_capture)()

    # ------------------------------------------------------------------ scrolling (also reveals a hidden answer)

    def _scroll(self, pages: float) -> None:
        self._reveal_answer()
        self.hud.scroll_by(pages)

    def scroll_up(self) -> None:
        self._scroll(-ARROW_SCROLL_PAGES)

    def scroll_down(self) -> None:
        self._scroll(ARROW_SCROLL_PAGES)

    def page_up(self) -> None:
        self._scroll(-PAGE_SCROLL_PAGES)

    def page_down(self) -> None:
        self._scroll(PAGE_SCROLL_PAGES)

    def scroll_top(self) -> None:
        self._reveal_answer()
        self.hud.scroll_to_end(bottom=False)

    def scroll_bottom(self) -> None:
        self._reveal_answer()
        self.hud.scroll_to_end(bottom=True)

    # ------------------------------------------------------------------ answer panel / enabled

    def toggle_answer(self) -> None:
        """Hides/shows just the answer panel; unlike disabling, everything else keeps working."""
        if not self.enabled:
            return
        self.answer_hidden = not self.answer_hidden
        self.hud.setVisible(not self.answer_hidden)

    def _reveal_answer(self) -> None:
        if self.enabled and self.answer_hidden:
            self.answer_hidden = False
            self.hud.show()

    def copy_answer(self) -> None:
        """Copies the answer text without the option number ("3. Anwser" -> "Anwser")."""
        text = formatting.copyable_answer(self.last_raw)
        if text:
            QApplication.clipboard().setText(text)
            self.hud.status.setText("Copied")

    def stop(self) -> None:
        if self.job is None:
            return
        self.job.cancel()
        self.job = None
        self.job_id += 1  # ignore anything the cancelled job still sends
        self.hud.spinner.stop()
        if formatting.parse_answers(self.last_raw):
            self.hud.status.setText("Stopped")  # keep the partial answer on screen
        else:
            self.hud.show_message("Stopped.")

    def toggle_enabled(self) -> None:
        self.set_enabled(not self.enabled)

    def set_enabled(self, on: bool) -> None:
        """Enabled = HUD shown and menu choices on; disabled = HUD hidden (the dot always stays)."""
        self.enabled = on
        self.answer_hidden = False
        self.dot.set_enabled(on)
        self.enabled_action.setChecked(on)
        if on:
            self.hud.show()
        else:
            if self.selector is not None:
                self.selector.finish(accept=False)
            self.hud.hide()

    # ------------------------------------------------------------------ capture

    def _grab_without_hud(self, then) -> None:
        """Hides the HUD (so it isn't in the screenshot), grabs the primary monitor, calls then(image)."""
        if self.busy_capturing or self.selector is not None:
            return
        self.busy_capturing = True
        was_visible = self.hud.isVisible()
        self.hotkeys.close_menu()
        self.menu.hide()
        self.hud.hide()
        self.dot.hide()

        def grab() -> None:
            try:
                image = capture.grab_primary()
            except Exception as exc:  # noqa: BLE001
                self.busy_capturing = False
                self.dot.show()
                self._show_hud()
                self.hud.show_error(f"Screen capture failed: {exc}")
                return
            self.busy_capturing = False
            self.dot.show()
            if was_visible:
                self.hud.show()
            then(image)

        QTimer.singleShot(HIDE_BEFORE_CAPTURE_MS, grab)  # the status dot is always on screen

    def capture_screen(self) -> None:
        self.last_capture = "capture_screen"
        self._grab_without_hud(self._analyze)

    def capture_region(self) -> None:
        self.last_capture = "capture_region"

        def open_selector(image: QImage) -> None:
            self.hud.hide()
            self.selector = RegionSelector(image)
            self.selector.selected.connect(self._on_region_selected)
            self.selector.cancelled.connect(self._on_region_closed)
            self.hotkeys.set_grab_escape(True)
            self.selector.show()

        self._grab_without_hud(open_selector)

    def recapture_region(self) -> None:
        """A fresh screenshot of the same box as the last region capture."""
        if self.last_region is None:
            return
        self.last_capture = "recapture_region"
        region = self.last_region
        self._grab_without_hud(lambda image: self._analyze(image.copy(region.intersected(image.rect()))))

    def retry(self) -> None:
        """Sends the last image again (e.g. after an error or a bad answer)."""
        if self.last_image is not None:
            self._analyze(self.last_image)

    def _on_region_selected(self, image: QImage, rect: QRect) -> None:
        self.last_region = rect
        self._on_region_closed()
        self._analyze(image)

    def _on_region_closed(self) -> None:
        self.hotkeys.set_grab_escape(False)
        self.selector = None
        if self.enabled and not self.answer_hidden:
            self.hud.show()

    def _show_hud(self) -> None:
        """Showing the HUD (e.g. for a new answer) re-enables and un-hides it."""
        if not self.enabled:
            self.set_enabled(True)
        self.answer_hidden = False
        self.hud.show()

    # ------------------------------------------------------------------ AI

    def _analyze(self, image: QImage) -> None:
        key = config.get_api_key()
        self._show_hud()
        if not key:
            self.hud.show_error("No OpenRouter API key. Right-click the UGH tray icon → Set API key…")
            return
        self.last_image = image
        self.last_raw = ""
        if self.job:
            self.job.cancel()
        self.job_id += 1
        job_id = self.job_id
        max_side = int(self.cfg.get("max_image_side", 2560))

        self.hud.clear()
        self.hud.show_loading("Analyzing...")
        self.job = ai.AnalysisJob(
            api_key=key,
            model=self.cfg.get("model") or config.DEFAULT_MODEL,
            prompt=self.cfg.get("capture_prompt") or config.DEFAULTS["capture_prompt"],
            get_png=lambda: capture.to_png(image, max_side),
            request_cfg=self.cfg.get("request", {}),
            callbacks=ai.Callbacks(
                on_status=lambda s: self.bridge.status.emit(job_id, s),
                on_progress=lambda t: self.bridge.progress.emit(job_id, t),
                on_done=lambda t: self.bridge.done.emit(job_id, t),
                on_error=lambda m: self.bridge.error.emit(job_id, m),
                on_thinking=lambda t, secs: self.bridge.thinking.emit(job_id, t, secs),
                on_tools=lambda entries: self.bridge.tools.emit(job_id, entries),
            ),
            show_thinking_after=float(self.cfg.get("show_thinking_after_seconds", 8)),
            use_tools=bool(self.cfg.get("tools", True)),
            explanations=bool(self.cfg.get("explanations", True)),
        )
        self.job.start()

    def _on_status(self, job_id: int, status: str) -> None:
        if job_id == self.job_id:
            self.hud.show_loading(status)

    def _on_thinking(self, job_id: int, text: str, seconds: int) -> None:
        if job_id == self.job_id:
            self.hud.show_thinking(text, seconds)

    def _on_tools(self, job_id: int, entries: list) -> None:
        if job_id == self.job_id:
            self.hud.show_tools(entries)

    def _on_progress(self, job_id: int, text: str) -> None:
        if job_id == self.job_id:
            self.last_raw = text
            self.hud.show_answer(text, final=False)

    def _on_done(self, job_id: int, text: str) -> None:
        if job_id == self.job_id:
            self.last_raw = text
            self.hud.show_answer(text, final=True)
            self.job = None

    def _on_error(self, job_id: int, message: str) -> None:
        if job_id == self.job_id:
            self.hud.show_error(message)
            self.job = None

    # ------------------------------------------------------------------ tray actions

    def set_api_key(self) -> None:
        current = config.get_api_key()
        label = (f"Saved key: {config.key_hint(current)}\nPaste a new key to replace it (leave blank to keep it):"
                 if current else "Paste your OpenRouter API key (from openrouter.ai/keys):")
        key, ok = QInputDialog.getText(None, "UGH Desktop – API key", label, QLineEdit.EchoMode.Password)
        if ok and key.strip():
            config.set_api_key(key)
            self.hud.show_message(f"API key saved. {self._hint_text()}")
            self._show_hud()

    def reload_settings(self) -> None:
        self.cfg = config.load_config()
        self._register_hotkeys()
        self.hud.hints.setText(self._hint_text())
        self.hud.apply_config(self.cfg["hud"])
        self.dot.place()
        self.tray.setContextMenu(self._build_menu())

    def quit(self) -> None:
        if self.job:
            self.job.cancel()
        self.hotkeys.stop()
        tools.shutdown()
        self.tray.hide()
        self.qapp.quit()


def main() -> int:
    qapp = QApplication(sys.argv)
    qapp.setApplicationName("UGH Desktop")
    qapp.setQuitOnLastWindowClosed(False)
    qapp.setWindowIcon(app_icon())

    # One instance only: two copies would both react to the menu key.
    lock = QLockFile(str(config.config_dir() / "ugh-desktop.lock"))
    if not lock.tryLock(100):
        QMessageBox.information(None, "UGH Desktop", "UGH Desktop is already running (see the tray icon).")
        return 0

    if not QSystemTrayIcon.isSystemTrayAvailable():
        QMessageBox.critical(None, "UGH Desktop", "No system tray available.")
        return 1

    app = App(qapp)  # noqa: F841 - kept alive by the event loop
    return qapp.exec()
