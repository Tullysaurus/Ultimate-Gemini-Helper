"""Application wiring: tray icon, hotkeys, capture -> AI -> HUD."""

from __future__ import annotations

import os
import sys

from PyQt6.QtCore import QLockFile, QObject, QTimer, pyqtSignal
from PyQt6.QtGui import QImage
from PyQt6.QtWidgets import QApplication, QInputDialog, QLineEdit, QMenu, QMessageBox, QSystemTrayIcon

from . import ai, capture, config
from .hotkeys import HotkeyManager, pretty
from .hud import Hud
from .icons import app_icon
from .region import RegionSelector

HIDE_BEFORE_CAPTURE_MS = 80  # give the compositor time to remove the HUD before grabbing


class Bridge(QObject):
    """Carries worker-thread callbacks onto the Qt thread. Each carries the job id."""
    status = pyqtSignal(int, str)
    progress = pyqtSignal(int, str)
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
        self.hud_wanted = True  # user's show/hide choice
        self.busy_capturing = False

        self.bridge = Bridge()
        self.bridge.status.connect(self._on_status)
        self.bridge.progress.connect(self._on_progress)
        self.bridge.done.connect(self._on_done)
        self.bridge.error.connect(self._on_error)

        self.hud = Hud(self.cfg["hud"], self._hint_text())
        self.hotkeys = HotkeyManager()
        self.hotkeys.triggered.connect(self._on_hotkey)
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

    # ------------------------------------------------------------------ setup

    def _hint_text(self) -> str:
        hk = self.cfg["hotkeys"]
        return (f"{pretty(hk['capture_screen'])} screen · {pretty(hk['capture_region'])} region · "
                f"{pretty(hk['toggle_hud'])} hide · {pretty(hk['scroll_up'])}/{pretty(hk['scroll_down']).split('+')[-1]} scroll")

    def _register_hotkeys(self) -> None:
        errors = self.hotkeys.register(self.cfg["hotkeys"])
        if errors:
            QMessageBox.warning(None, "UGH Desktop", "Some hotkeys couldn't be registered:\n\n" + "\n".join(errors))

    def _build_menu(self) -> QMenu:
        menu = QMenu()
        hk = self.cfg["hotkeys"]
        menu.addAction(f"Capture screen\t{pretty(hk['capture_screen'])}", self.capture_screen)
        menu.addAction(f"Capture region\t{pretty(hk['capture_region'])}", self.capture_region)
        menu.addAction(f"Show / hide HUD\t{pretty(hk['toggle_hud'])}", self.toggle_hud)
        menu.addSeparator()
        menu.addAction("Set API key…", self.set_api_key)
        menu.addAction("Open settings file", lambda: os.startfile(config.config_path()))  # noqa: S606
        menu.addAction("Reload settings", self.reload_settings)
        menu.addSeparator()
        menu.addAction("Quit", self.quit)
        return menu

    # ------------------------------------------------------------------ actions

    def _on_hotkey(self, action: str) -> None:
        handlers = {
            "capture_screen": self.capture_screen,
            "capture_region": self.capture_region,
            "toggle_hud": self.toggle_hud,
            "scroll_up": lambda: self.hud.scroll_by(-0.8),
            "scroll_down": lambda: self.hud.scroll_by(0.8),
            "region_cancel": lambda: self.selector and self.selector.finish(accept=False),
        }
        handler = handlers.get(action)
        if handler:
            handler()

    def toggle_hud(self) -> None:
        self.hud_wanted = not self.hud.isVisible()
        self.hud.setVisible(self.hud_wanted)

    def _grab_without_hud(self, then) -> None:
        """Hides the HUD (so it isn't in the screenshot), grabs the primary monitor, calls then(image)."""
        if self.busy_capturing or self.selector is not None:
            return
        self.busy_capturing = True
        was_visible = self.hud.isVisible()
        self.hud.hide()

        def grab() -> None:
            try:
                image = capture.grab_primary()
            except Exception as exc:  # noqa: BLE001
                self.busy_capturing = False
                self._show_hud()
                self.hud.show_error(f"Screen capture failed: {exc}")
                return
            self.busy_capturing = False
            if was_visible:
                self.hud.show()
            then(image)

        QTimer.singleShot(HIDE_BEFORE_CAPTURE_MS if was_visible else 0, grab)

    def capture_screen(self) -> None:
        self._grab_without_hud(self._analyze)

    def capture_region(self) -> None:
        def open_selector(image: QImage) -> None:
            self.hud.hide()
            self.selector = RegionSelector(image)
            self.selector.selected.connect(self._on_region_selected)
            self.selector.cancelled.connect(self._on_region_closed)
            self.hotkeys.add_temporary("region_cancel", "esc")
            self.selector.show()

        self._grab_without_hud(open_selector)

    def _on_region_selected(self, image: QImage) -> None:
        self._on_region_closed()
        self._analyze(image)

    def _on_region_closed(self) -> None:
        self.hotkeys.remove_temporary("region_cancel")
        self.selector = None
        if self.hud_wanted:
            self.hud.show()

    def _show_hud(self) -> None:
        self.hud_wanted = True
        self.hud.show()

    # ------------------------------------------------------------------ AI

    def _analyze(self, image: QImage) -> None:
        key = config.get_api_key()
        self._show_hud()
        if not key:
            self.hud.show_error("No OpenRouter API key. Right-click the UGH tray icon → Set API key…")
            return
        if self.job:
            self.job.cancel()
        self.job_id += 1
        job_id = self.job_id
        max_side = int(self.cfg.get("max_image_side", 2560))

        self.hud.body.clear()
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
            ),
        )
        self.job.start()

    def _on_status(self, job_id: int, status: str) -> None:
        if job_id == self.job_id:
            self.hud.show_loading(status)

    def _on_progress(self, job_id: int, text: str) -> None:
        if job_id == self.job_id:
            self.hud.show_answer(text, final=False)

    def _on_done(self, job_id: int, text: str) -> None:
        if job_id == self.job_id:
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
        self.tray.setContextMenu(self._build_menu())

    def quit(self) -> None:
        if self.job:
            self.job.cancel()
        self.hotkeys.unregister_all()
        self.tray.hide()
        self.qapp.quit()


def main() -> int:
    qapp = QApplication(sys.argv)
    qapp.setApplicationName("UGH Desktop")
    qapp.setQuitOnLastWindowClosed(False)
    qapp.setWindowIcon(app_icon())

    # One instance only: two copies would register the same hotkeys twice.
    lock = QLockFile(str(config.config_dir() / "ugh-desktop.lock"))
    if not lock.tryLock(100):
        QMessageBox.information(None, "UGH Desktop", "UGH Desktop is already running (see the tray icon).")
        return 0

    if not QSystemTrayIcon.isSystemTrayAvailable():
        QMessageBox.critical(None, "UGH Desktop", "No system tray available.")
        return 1

    app = App(qapp)  # noqa: F841 - kept alive by the event loop
    return qapp.exec()
