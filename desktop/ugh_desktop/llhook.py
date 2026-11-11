"""Win32 low-level keyboard + mouse hooks on a dedicated thread, and SendInput helpers (ctypes).

Events we inject ourselves carry INJECT_TAG in dwExtraInfo; the hooks let them (and any other
injected input) straight through without calling the callbacks.
"""

from __future__ import annotations

import ctypes
import threading
from ctypes import wintypes

INJECT_TAG = 0x55474844  # "UGHD"

WH_KEYBOARD_LL = 13
WH_MOUSE_LL = 14
HC_ACTION = 0
WM_QUIT = 0x0012
WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP = 0x0100, 0x0101, 0x0104, 0x0105
LLKHF_EXTENDED = 0x01
LLKHF_INJECTED = 0x10
LLMHF_INJECTED = 0x01
EVENT_SYSTEM_DESKTOPSWITCH = 0x0020
WINEVENT_OUTOFCONTEXT = 0x0000

INPUT_MOUSE, INPUT_KEYBOARD = 0, 1
KEYEVENTF_EXTENDEDKEY = 0x0001
KEYEVENTF_KEYUP = 0x0002

# Mouse hook message -> (MOUSEINPUT flag, does mouseData's high word carry data?)
_MOUSE_BUTTONS = {
    0x0201: (0x0002, False),  # left down
    0x0202: (0x0004, False),  # left up
    0x0204: (0x0008, False),  # right down
    0x0205: (0x0010, False),  # right up
    0x0207: (0x0020, False),  # middle down
    0x0208: (0x0040, False),  # middle up
    0x020B: (0x0080, True),   # X button down (which one is in the high word)
    0x020C: (0x0100, True),   # X button up
    0x020A: (0x0800, True),   # wheel (delta in the high word)
    0x020E: (0x1000, True),   # horizontal wheel
}

ULONG_PTR = ctypes.c_size_t
LRESULT = wintypes.LPARAM


class KBDLLHOOKSTRUCT(ctypes.Structure):
    _fields_ = [("vkCode", wintypes.DWORD), ("scanCode", wintypes.DWORD), ("flags", wintypes.DWORD),
                ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]


class MSLLHOOKSTRUCT(ctypes.Structure):
    _fields_ = [("pt", wintypes.POINT), ("mouseData", wintypes.DWORD), ("flags", wintypes.DWORD),
                ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD),
                ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD),
                ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]


class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [("uMsg", wintypes.DWORD), ("wParamL", wintypes.WORD), ("wParamH", wintypes.WORD)]


class _INPUTUNION(ctypes.Union):
    _fields_ = [("ki", KEYBDINPUT), ("mi", MOUSEINPUT), ("hi", HARDWAREINPUT)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", wintypes.DWORD), ("u", _INPUTUNION)]


HOOKPROC = ctypes.WINFUNCTYPE(LRESULT, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM)
WINEVENTPROC = ctypes.WINFUNCTYPE(None, wintypes.HANDLE, wintypes.DWORD, wintypes.HWND, wintypes.LONG,
                                  wintypes.LONG, wintypes.DWORD, wintypes.DWORD)

_user32 = ctypes.WinDLL("user32", use_last_error=True)
_kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
_user32.SetWindowsHookExW.argtypes = [ctypes.c_int, HOOKPROC, wintypes.HINSTANCE, wintypes.DWORD]
_user32.SetWindowsHookExW.restype = wintypes.HHOOK
_user32.CallNextHookEx.argtypes = [wintypes.HHOOK, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM]
_user32.CallNextHookEx.restype = LRESULT
_user32.UnhookWindowsHookEx.argtypes = [wintypes.HHOOK]
_user32.SetWinEventHook.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.HMODULE, WINEVENTPROC,
                                    wintypes.DWORD, wintypes.DWORD, wintypes.DWORD]
_user32.SetWinEventHook.restype = wintypes.HANDLE
_user32.UnhookWinEvent.argtypes = [wintypes.HANDLE]
_user32.GetMessageW.argtypes = [ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT]
_user32.PostThreadMessageW.argtypes = [wintypes.DWORD, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
_user32.SendInput.argtypes = [wintypes.UINT, ctypes.POINTER(INPUT), ctypes.c_int]
_user32.SendInput.restype = wintypes.UINT
_kernel32.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
_kernel32.GetModuleHandleW.restype = wintypes.HMODULE


def key_input(vk: int, scan: int, extended: bool, up: bool) -> INPUT:
    flags = (KEYEVENTF_EXTENDEDKEY if extended else 0) | (KEYEVENTF_KEYUP if up else 0)
    inp = INPUT(type=INPUT_KEYBOARD)
    inp.u.ki = KEYBDINPUT(wVk=vk, wScan=scan, dwFlags=flags, time=0, dwExtraInfo=INJECT_TAG)
    return inp


def send(inputs: list[INPUT]) -> None:
    if inputs:
        arr = (INPUT * len(inputs))(*inputs)
        _user32.SendInput(len(inputs), arr, ctypes.sizeof(INPUT))


class LowLevelHooks:
    """Runs the hooks on their own thread with a message loop (LL hooks are called on the installing thread).

    on_key(vk, scan, extended, down) -> True to pass the event on, False to block it.
    on_mouse(replay) -> same, for button / wheel events (not moves); `replay` is an INPUT
        that re-creates the event, for when the callback blocks it and re-sends it later.
    on_desktop_switch() -> called when the input desktop changes (Ctrl+Alt+Del, lock, UAC),
        where key-ups go missing.
    """

    def __init__(self, on_key, on_mouse, on_desktop_switch):
        self._on_key = on_key
        self._on_mouse = on_mouse
        self._on_desktop_switch = on_desktop_switch
        self._thread: threading.Thread | None = None
        self._thread_id = 0
        # Keep references: ctypes callbacks must outlive the hooks.
        self._kb_proc = HOOKPROC(self._keyboard_proc)
        self._ms_proc = HOOKPROC(self._mouse_proc)
        self._we_proc = WINEVENTPROC(lambda *_: self._safe(self._on_desktop_switch))

    def start(self) -> None:
        if self._thread is not None:
            return
        ready = threading.Event()
        self._thread = threading.Thread(target=self._run, args=(ready,), name="ugh-hooks", daemon=True)
        self._thread.start()
        ready.wait(2)

    def stop(self) -> None:
        if self._thread is not None and self._thread_id:
            _user32.PostThreadMessageW(self._thread_id, WM_QUIT, 0, 0)
            self._thread.join(2)
        self._thread = None

    def _run(self, ready: threading.Event) -> None:
        self._thread_id = _kernel32.GetCurrentThreadId()
        module = _kernel32.GetModuleHandleW(None)
        kb = _user32.SetWindowsHookExW(WH_KEYBOARD_LL, self._kb_proc, module, 0)
        ms = _user32.SetWindowsHookExW(WH_MOUSE_LL, self._ms_proc, module, 0)
        we = _user32.SetWinEventHook(EVENT_SYSTEM_DESKTOPSWITCH, EVENT_SYSTEM_DESKTOPSWITCH, None,
                                     self._we_proc, 0, 0, WINEVENT_OUTOFCONTEXT)
        ready.set()
        msg = wintypes.MSG()
        while _user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            pass
        for hook in (kb, ms):
            if hook:
                _user32.UnhookWindowsHookEx(hook)
        if we:
            _user32.UnhookWinEvent(we)

    @staticmethod
    def _safe(fn, *args, default=True):
        try:
            return fn(*args)
        except Exception:  # noqa: BLE001 - an exception must never escape into the OS hook chain
            import traceback
            traceback.print_exc()
            return default

    def _keyboard_proc(self, n_code: int, w_param: int, l_param: int) -> int:
        if n_code == HC_ACTION:
            k = ctypes.cast(l_param, ctypes.POINTER(KBDLLHOOKSTRUCT)).contents
            if not (k.flags & LLKHF_INJECTED):
                down = w_param in (WM_KEYDOWN, WM_SYSKEYDOWN)
                if not self._safe(self._on_key, k.vkCode, k.scanCode, bool(k.flags & LLKHF_EXTENDED), down):
                    return 1
        return _user32.CallNextHookEx(None, n_code, w_param, l_param)

    def _mouse_proc(self, n_code: int, w_param: int, l_param: int) -> int:
        if n_code == HC_ACTION and w_param in _MOUSE_BUTTONS:
            m = ctypes.cast(l_param, ctypes.POINTER(MSLLHOOKSTRUCT)).contents
            if not (m.flags & LLMHF_INJECTED):
                flag, has_data = _MOUSE_BUTTONS[w_param]
                replay = INPUT(type=INPUT_MOUSE)
                # High word is signed (wheel delta); MOUSEINPUT wants it sign-extended to 32 bits.
                data = (ctypes.c_short(m.mouseData >> 16).value & 0xFFFFFFFF) if has_data else 0
                replay.u.mi = MOUSEINPUT(dx=0, dy=0, mouseData=data,
                                         dwFlags=flag, time=0, dwExtraInfo=INJECT_TAG)
                if not self._safe(self._on_mouse, replay):
                    return 1
        return _user32.CallNextHookEx(None, n_code, w_param, l_param)
