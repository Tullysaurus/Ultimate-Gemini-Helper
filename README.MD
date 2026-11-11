# Ultimate Gemini Helper (UGH)

> A free, open-source AI helper that lives in your browser.

Highlight text or images on any webpage, or drag a box over part of the screen, and get an answer from an AI model. It's a single [Tampermonkey](https://www.tampermonkey.net/) userscript that talks directly to [OpenRouter](https://openrouter.ai) with your own API key. There's no server to host.

There's also a [Windows desktop version](#desktop-app-windows): a small always-on-top panel that answers questions about screenshots of your whole screen, driven by Ctrl+Alt hotkeys.

## Contents

- [Desktop app (Windows)](#desktop-app-windows)
- [Features](#features)
- [Install](#install)
- [Usage](#usage)
- [Settings](#settings)
- [Privacy: what websites can see](#privacy-what-websites-can-see)
- [Event monitor](#event-monitor)
- [Repository layout](#repository-layout)
- [Limitations](#limitations)

## Desktop app (Windows)

[`desktop/`](desktop/) is a Python/PyQt6 app for when the question isn't in a browser. It shows a small panel (the HUD) in a corner of your screen, styled like the userscript's popup. Press `Ctrl+Alt+S` to screenshot your primary monitor, or `Ctrl+Alt+P` to drag a box over part of it, and the answer streams into the panel.

- **Stays out of the way.** The panel is always on top, doesn't take keyboard focus, and lets clicks pass through to whatever is underneath. It stays visible over borderless-fullscreen apps, but not over exclusive-fullscreen games.
- **Screenshots** are taken with [mss](https://github.com/BoboTiG/python-mss): no capture sound and no permission prompt. The panel hides itself for the moment of the capture so it isn't in the image.
- **Ctrl+Alt hotkeys** control everything. Keys are read with a global hook from the [keyboard](https://github.com/boppreh/keyboard) package, which consumes the hotkeys so they never reach the app you're in.
- **LaTeX** in answers is rendered with matplotlib's math renderer. Formulas it can't handle are shown as source.
- **API key** is stored in Windows Credential Manager. Everything else is in `%APPDATA%\UGH\config.json`.

### Run it

```powershell
cd desktop
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python main.py
```

A UGH icon appears in the system tray. Right-click it, choose **Set API key…**, and paste your OpenRouter key.

While you're changing code, just run `main.py` as above. A build is only needed for a standalone exe.

To build a single `UGH.exe` (in `desktop\dist\`), run:

```powershell
powershell -ExecutionPolicy Bypass -File desktop\build.ps1
```

Add `-Fast` for a folder build (`desktop\dist\UGH\UGH.exe`) that builds and starts faster but has to be shared as a whole folder. Packages are only reinstalled when `requirements.txt` changes (`-Reinstall` forces it), and PyInstaller's cache is reused between builds (`-Clean` discards it).

### Hotkeys

| Key | Action |
| --- | --- |
| `Ctrl+Alt+S` | Capture the whole primary monitor and ask |
| `Ctrl+Alt+P` | Drag-select an area and ask (`Esc` or right-click cancels) |
| `Ctrl+Alt+H` | Show or hide the HUD |
| `Ctrl+Alt+Up` / `Ctrl+Alt+Down` | Scroll the explanation up / down (hold to keep scrolling; the answer stays pinned at the top) |
| `Ctrl+Alt+D` | Enable / disable all the other hotkeys (always works). Disabling also hides the HUD; enabling brings it back |

The letter or arrow key of a hotkey never reaches the app you're in; `Ctrl` and `Alt` themselves do, since they're also part of every other shortcut. While the hotkeys are disabled, those combinations pass through to apps normally.

A tiny dot in the top-right corner of the screen shows the state: green when the hotkeys are enabled, red when disabled. It stays visible when the HUD is hidden (it only disappears for the instant of a capture). The hotkeys start enabled every time the app launches, and can also be toggled from the tray menu.

Change the model, prompt, HUD corner, width and opacity in `config.json` (tray menu → **Open settings file**), then choose **Reload settings**. Each capture is a separate question; there are no follow-ups.

### Notes

- **Elevated apps.** The hotkeys don't work while an app running as administrator is focused, unless UGH also runs as administrator.
- **Multiple monitors.** Only the primary monitor is captured.

## Features

- **Ask about a selection.** Highlight text and/or images, then click the button in the bottom-left corner.
- **Capture Area.** Press `Alt+Shift+S` (or use the hover menu), drag over any part of the page, and the screenshot is sent to the model.
  - *Exact* mode (default) uses the browser's tab capture. It asks once per tab to share it, then captures the real pixels, including embedded pages from other sites and LaTeX.
  - *Fast* mode redraws the page from its HTML without asking. Embedded pages from other sites come out blank, and some content may render imperfectly.
- **Streaming answers** in a draggable popup, with follow-up questions. Follow-ups include the previous screenshot.
- **LaTeX rendering.** Math in answers (`\( \)`, `\[ \]`, `$ $`, `$$ $$`) is rendered with KaTeX as MathML. The browser draws MathML itself, so no fonts or stylesheets need to load and a site's security rules can't block it.
- **Any OpenRouter model.** The default is `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`, which is free and handles both text and images.
- **Local cache and history.** Text-only questions are cached, and the last few messages are kept so follow-ups have context. Everything is stored in Tampermonkey's own storage.

## Install

1. Install the [Tampermonkey](https://www.tampermonkey.net/) extension (Violentmonkey also works).
2. Create a new script and paste in the contents of [`tampermonkey/ugh.js`](tampermonkey/ugh.js), or open the raw file and let Tampermonkey install it.
3. Get an API key at <https://openrouter.ai/keys>. Free models work with a free account.

On Chrome and Edge, Tampermonkey may also need **"Allow User Scripts"** turned on in the extension's details page.

## Usage

### Save your API key

1. Open any webpage.
2. Hover the button in the bottom-left corner to open the menu.
3. Paste your OpenRouter key and click **Save**.

The key is stored in Tampermonkey's storage. The settings field only ever shows a shortened hint of it (e.g. `sk-or-v1…abcd`).

### Ask a question

- **Selection:** highlight text or images, then click the button.
- **Screenshot:** press `Alt+Shift+S` (or hover the button, then click **Capture Area**) and drag over the question. Press `Esc` or right-click to cancel.
- **Follow up:** type in the popup's input box and press Enter.

## Settings

All settings are in the hover menu.

| Setting | Description |
| --- | --- |
| OpenRouter API Key | Your key. Leave the field blank to keep the saved key. |
| Model | Any OpenRouter model ID. Leave it blank for the default. Pick a model that accepts images if you use screenshots. |
| Screenshot Mode | *Exact* (tab capture, asks once per tab) or *Fast* (no prompt, less accurate). |
| Clear Chat History & Cache | Clears the saved follow-up context and cached answers. |

## Privacy: what websites can see

The script is built so that websites can't read your key, your questions or the answers, or interfere with them:

- **Requests.** Calls to OpenRouter and image downloads go through Tampermonkey itself. They aren't visible to the page and aren't affected by its CORS or content-security rules.
- **Isolated JavaScript world.** The script runs in an isolated world (`@sandbox DOM` / `@inject-into content`). It also saves its own copies of sensitive browser functions at page start, so page code can't intercept them.
- **Closed shadow root.** The interface is inside a closed shadow root, so page CSS and scripts can't reach it.
- **Event firewall.** Listeners registered before any page listener block every event aimed at the script's interface (key presses, typed text, paste, mouse and pointer movement, clicks, focus events). The script's own handlers get a private copy.
- **No `window` events.** Nothing is sent on `window` events.
- **No focus stealing.** Using the button, menu or capture overlay doesn't move focus off the page. Only clicking into a text field, the dropdown or the answer text does.

What a page **can** still see:

- The `<ugh-root>` element attached to `<html>`.
- That focus moved to `<ugh-root>` when you click into one of the script's text fields. The page's own `blur`, `focusout` and `mouseout` events show `<ugh-root>` as their `relatedTarget`.
- The `Alt` and `Shift` presses of the `Alt+Shift+S` hotkey. The `S` is consumed.
- The browser's tab-share prompt in Exact mode, which may briefly take focus.
- In Fast mode, html2canvas briefly adds a copy of the page in an iframe.

Use the [event monitor](#event-monitor) to check all of this yourself.

## Event monitor

[`tools/event-monitor.html`](tools/event-monitor.html) is a standalone test page that logs everything an ordinary web page can observe, so you can see exactly what the script exposes:

- **DOM events.** Every event type the browser supports, listened for on `window` before anything else: keys, typed text, clipboard, mouse, pointer, touch, wheel, scroll, focus and blur (including on `div`s), drag, resize, visibility, page lifecycle, messages and more. Each row shows the target, the event details and `isTrusted`.
- **Live state.** `document.hasFocus()`, `activeElement`, visibility, user activation, window and screen size and position, scroll position, the current selection and the elements under `<html>`.
- **DOM mutations.** Elements and styles added or removed anywhere in the document.
- **Network.** Resources the page itself loads, such as fonts and scripts.
- **New globals** added to `window`.

Rows are highlighted in yellow when their target isn't part of the page, such as an injected element. You can filter by category or text, show only foreign targets, collapse repeated rows, pause the log, or copy it.

To try it, open the file in a browser with the script enabled. For `file://` pages, turn on **"Allow access to file URLs"** in Tampermonkey's extension settings, or serve the folder locally (for example `python -m http.server`) and open `http://localhost:8000/tools/event-monitor.html`.

## Repository layout

```text
tampermonkey/ugh.js        the userscript
tools/event-monitor.html   page that logs what a website can observe
desktop/                   Windows desktop HUD (Python, PyQt6)
  main.py                  entry point
  build.ps1                builds dist\UGH.exe with PyInstaller
  ugh_desktop/
    app.py                 tray icon, hotkeys, capture -> AI -> HUD
    hud.py                 the always-on-top, click-through panel and status dot
    region.py              drag-to-select overlay
    capture.py             mss screen capture
    ai.py                  OpenRouter streaming client
    formatting.py          Markdown + LaTeX -> Qt rich text
    hotkeys.py             global keyboard hook (Ctrl+Alt hotkeys)
    winapi.py              Windows window styles (ctypes)
    config.py              settings file and API key storage
    icons.py               app icon
```

## Limitations

- **Running first isn't guaranteed.** The event firewall relies on the script running before page scripts. Tampermonkey's `document-start` normally does, but it isn't guaranteed in every browser.
- **Exact mode works best in Chrome and Edge,** which offer "this tab" directly. Other browsers may offer a window or the whole screen instead; the script rejects those and asks you to share the tab.
- **Copy-protected video can't be captured.** Netflix-style video comes out black.
- **Free models have limits.** Free OpenRouter models are rate-limited, and reasoning models can take a while to "think" before answering.

## License

GPL-3.0
