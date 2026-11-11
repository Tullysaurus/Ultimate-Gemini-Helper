// ==UserScript==
// @name         Ultimate Gemini Helper
// @namespace    http://tampermonkey.net/
// @version      3.0.0
// @description  Highlight text/images on any page and ask an AI (via OpenRouter) for the answer. No external server required.
// @author       Tullysaurus
// @license      GPL-3.0
// @match        *://*/*
// @grant        GM_log
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @require      https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/katex.min.js
// @connect      openrouter.ai
// @connect      *
// @run-at       document-start
// @sandbox      DOM
// @inject-into  content
// ==/UserScript==

(function () {
    "use strict";

    /* =====================================================================
     *  CORE: settings, history, cache, OpenRouter requests
     * ===================================================================== */

    const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
    const DEFAULT_MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free"; // handles both text and images

    const STORAGE = {
        apiKey: "UGH_OPENROUTER_API_KEY",
        model: "UGH_MODEL",
        history: "UGH_CHAT_HISTORY",
        cache: "UGH_RESPONSE_CACHE",
        popupPos: "UGH_POPUP_POS",
        captureMode: "UGH_CAPTURE_MODE"
    };

    // Native browser functions, saved at document-start before page scripts run.
    // "@sandbox DOM" / "@inject-into content" already run this script in an
    // isolated world where page patches can't reach these. Caching them also
    // covers script managers that ignore those directives: a page that wraps
    // e.g. attachShadow, innerHTML or toDataURL can't capture our UI, answers,
    // typed text or screenshots.
    const N = (() => {
        const desc = (proto, prop) => Object.getOwnPropertyDescriptor(proto, prop);
        return {
            createElement: Document.prototype.createElement,
            attachShadow: Element.prototype.attachShadow,
            setInnerHTML: desc(Element.prototype, "innerHTML").set,
            inputValue: desc(HTMLInputElement.prototype, "value"),
            addEventListener: EventTarget.prototype.addEventListener,
            removeEventListener: EventTarget.prototype.removeEventListener,
            dispatchEvent: EventTarget.prototype.dispatchEvent,
            stopImmediatePropagation: Event.prototype.stopImmediatePropagation,
            preventDefault: Event.prototype.preventDefault,
            setPointerCapture: Element.prototype.setPointerCapture,
            getContext: HTMLCanvasElement.prototype.getContext,
            toDataURL: HTMLCanvasElement.prototype.toDataURL,
            drawImage: CanvasRenderingContext2D.prototype.drawImage,
            setSrcObject: desc(HTMLMediaElement.prototype, "srcObject").set,
            play: HTMLMediaElement.prototype.play,
            getDisplayMedia: navigator.mediaDevices?.getDisplayMedia?.bind(navigator.mediaDevices) || null
        };
    })();

    const realWindow = Object.getOwnPropertyDescriptor(Document.prototype, "defaultView").get.call(document);

    const mk = (tag) => N.createElement.call(document, tag);
    const setHTML = (el, html) => N.setInnerHTML.call(el, html);
    const getVal = (input) => N.inputValue.get.call(input);
    const setVal = (input, v) => N.inputValue.set.call(input, v);
    const listen = (target, type, fn, capture = false) => N.addEventListener.call(target, type, fn, capture);
    const unlisten = (target, type, fn, capture = false) => N.removeEventListener.call(target, type, fn, capture);

    const MAX_HISTORY_MESSAGES = 10; // user + assistant messages kept for follow-ups
    const MAX_CACHE_ENTRIES = 200;

    const CONFIG = {
        temperature: 0.2,
        top_p: 0.95,
        // Reasoning models spend tokens "thinking" before answering, so leave plenty of room.
        max_tokens: 16384,
        reasoning: { effort: "low" }
    };

    const SYSTEM_PROMPT = `
You are an expert educational AI assistant. Your task is to analyze the preceeding question or text and identify the correct answer.
STRICT FORMATTING RULES:
1. **Correct Answer**: Provide the direct answer clearly.
2. **Explanation**: Provide concise reasoning below it.
3. **Rich Text**:
   - Use **bold** for key terms and the correct option.
   - Use *italics* for emphasis or definitions.
   - Use lists (lines starting with -) for steps or multiple points.
   - Use \`code\` formatting for technical terms if relevant (not for math).
   - Write math in LaTeX: \\( ... \\) for inline math and \\[ ... \\] for display math. Make sure every brace and delimiter is balanced.
4. **No Chattyness**: Do NOT ask if the user needs more help. Do NOT ask follow-up questions. End the response immediately after the explanation.
5. **No Images**: Do not include images or references to images in your output.
6. **Proper Answers**: Make sure that the output answers are always IDENTICAL to the original choices, include any spelling mistakes or weird punctuation.
7. **Lists**: If there are multiple correct answers, you are to list them, separated by " || " (spaces included).
No matter what, you are to always follow these formatting rules in your responses. Do not use any previous context to generate your responses, treat each prompt as its own chat.
OUTPUT STRUCTURE:
Correct Answer: [Answer1 || Answer2 || ...]

Explanation: [Rich Text Explanation]
`.trim();

    let currentRequest = null;
    let currentAnalysisId = 0;
    let lastImages = []; // images from the last new question, re-sent with popup follow-ups

    // --- Settings ---
    const getApiKey = () => GM_getValue(STORAGE.apiKey, "");
    const setApiKey = (key) => GM_setValue(STORAGE.apiKey, (key || "").trim());
    const getModel = () => GM_getValue(STORAGE.model, "") || DEFAULT_MODEL;
    const getKeyHint = () => {
        const key = getApiKey();
        return key ? `${key.slice(0, 8)}…${key.slice(-4)}` : "";
    };
    // "exact" = real pixels via tab capture (asks permission once per tab),
    // "fast"  = re-render the page with html2canvas (no prompt, can miss iframes/LaTeX)
    const getCaptureMode = () => (GM_getValue(STORAGE.captureMode, "exact") === "fast" ? "fast" : "exact");
    const saveSettings = ({ key, model, captureMode }) => {
        if (key && key.trim()) setApiKey(key); // blank input keeps the existing key
        if (model !== undefined) GM_setValue(STORAGE.model, (model || "").trim());
        if (captureMode !== undefined) GM_setValue(STORAGE.captureMode, captureMode === "fast" ? "fast" : "exact");
    };

    // --- History ---
    const getHistory = () => {
        const history = GM_getValue(STORAGE.history, []);
        return Array.isArray(history) ? history : [];
    };
    const saveHistory = (history) => GM_setValue(STORAGE.history, history.slice(-MAX_HISTORY_MESSAGES));

    // --- Cache ("/ask" reuses answers, "/ai" regenerates) ---
    const getCache = () => {
        const cache = GM_getValue(STORAGE.cache, {});
        return cache && typeof cache === "object" ? cache : {};
    };
    const getCachedResponse = (prompt) => getCache()[prompt]?.response || null;
    const setCachedResponse = (prompt, response) => {
        const cache = getCache();
        cache[prompt] = { response, createdAt: Date.now() };
        const keys = Object.keys(cache);
        if (keys.length > MAX_CACHE_ENTRIES) {
            keys.sort((a, b) => cache[a].createdAt - cache[b].createdAt)
                .slice(0, keys.length - MAX_CACHE_ENTRIES)
                .forEach((k) => delete cache[k]);
        }
        GM_setValue(STORAGE.cache, cache);
    };
    const clearHistoryAndCache = () => {
        GM_setValue(STORAGE.history, []);
        GM_setValue(STORAGE.cache, {});
    };

    // --- Helpers ---
    const fetchImageAsBase64 = (imageUrl) => new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method: "GET",
            url: imageUrl,
            responseType: "blob",
            onload: (response) => {
                if (response.status < 200 || response.status >= 300) return reject(`Status: ${response.status}`);
                const reader = new FileReader();
                reader.onloadend = () => {
                    const dataUrl = reader.result;
                    resolve({
                        mimeType: dataUrl.substring(dataUrl.indexOf(":") + 1, dataUrl.indexOf(";")),
                        base64Data: dataUrl.substring(dataUrl.indexOf(",") + 1)
                    });
                };
                reader.readAsDataURL(response.response);
            },
            onerror: () => reject("Network error"),
            ontimeout: () => reject("Timeout")
        });
    });

    const describeHttpError = (status, bodyText) => {
        let detail = "";
        try {
            detail = JSON.parse(bodyText)?.error?.message || "";
        } catch (_) {
            detail = (bodyText || "").slice(0, 300);
        }
        if (status === 401) return "Invalid OpenRouter API key. Update it in the settings menu (hover the bottom-left button).";
        if (status === 402) return "OpenRouter: insufficient credits for this model.";
        if (status === 429) return "OpenRouter rate limit hit (free models are limited). Wait a moment and try again.";
        return `OpenRouter error ${status}${detail ? `: ${detail}` : ""}`;
    };

    const buildPrompt = (text, hasImages = false) => {
        let prompt = `${text}`;
        if (hasImages) prompt += `\n(Note: attached images are part of the question context)\n`;
        return prompt;
    };

    const collectImages = async (imageInput, analysisId) => {
        const images = [];
        if (!imageInput) return images;
        const list = Array.isArray(imageInput) ? imageInput : [imageInput];
        for (const img of list) {
            if (analysisId !== currentAnalysisId) return images;
            try {
                if (img && typeof img === "object" && img.base64Data && img.mimeType) images.push(img);
                else if (typeof img === "string" && img.startsWith("http")) images.push(await fetchImageAsBase64(img));
            } catch (err) {
                GM_log("UGH: Image processing error", err);
            }
        }
        return images;
    };

    /**
     * Sends the prompt to OpenRouter and streams the reply.
     * @param {string} text
     * @param {Array<object|string>} imageInput - {base64Data, mimeType} objects or image URLs
     * @param {string} endpoint - "/ask" uses the local cache, "/ai" always regenerates
     */
    const performAnalysis = async (text, imageInput, endpoint = "/ask", isFollowUp = false) => {
        const analysisId = ++currentAnalysisId;

        if (currentRequest) {
            try { currentRequest.abort(); } catch (_) { /* ignore */ }
            currentRequest = null;
        }

        emit("UGH_Response_Loading", { message: "Analyzing..." });

        const apiKey = getApiKey();
        if (!apiKey) {
            emit("UGH_Response_Error", {
                message: "OpenRouter API key missing. Hover the bottom-left button and paste your key (get one at openrouter.ai/keys)."
            });
            return;
        }

        const images = await collectImages(imageInput, analysisId);
        if (analysisId !== currentAnalysisId) return;
        if (!isFollowUp) lastImages = images; // follow-ups re-send the same images

        // Only text-only prompts are cached: the cache is keyed on text, so
        // different screenshots with the same prompt would collide.
        const cacheable = images.length === 0;

        const promptText = buildPrompt(text || "", images.length > 0).trim();

        if (cacheable && endpoint !== "/ai" && promptText.length > 0) {
            const cached = getCachedResponse(promptText);
            if (cached) {
                GM_log("UGH: Using cached response");
                emit("UGH_Response_Success", { text: cached });
                return;
            }
        }

        let userContent = promptText;
        if (images.length > 0) {
            userContent = [{ type: "text", text: promptText || "Analyze the attached image." }];
            for (const img of images) {
                userContent.push({ type: "image_url", image_url: { url: `data:${img.mimeType};base64,${img.base64Data}` } });
            }
        }

        const history = getHistory();
        const payload = {
            model: getModel(),
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                ...history,
                { role: "user", content: userContent }
            ],
            stream: true,
            ...CONFIG
        };

        let accumulatedText = "";
        let finishReason = null;
        let thinkingShown = false;
        let finished = false;
        let sseBuffer = "";

        const finish = () => {
            if (finished || analysisId !== currentAnalysisId) return;
            finished = true;
            currentRequest = null;
            if (!accumulatedText.trim()) {
                emit("UGH_Response_Error", {
                    message: finishReason === "length"
                        ? "The model ran out of tokens while thinking. Try again or pick a different model."
                        : "The model returned an empty response. Try again or pick a different model."
                });
                return;
            }
            emit("UGH_Response_Success", { text: accumulatedText });
            saveHistory([
                ...history,
                { role: "user", content: promptText },
                { role: "assistant", content: accumulatedText }
            ]);
            if (cacheable && promptText.length > 0) setCachedResponse(promptText, accumulatedText);
        };

        const fail = (message) => {
            if (finished || analysisId !== currentAnalysisId) return;
            finished = true;
            currentRequest = null;
            emit("UGH_Response_Error", { message });
        };

        // Parses OpenRouter Server-Sent Events. Returns false if an error was hit.
        const consumeSse = (chunk) => {
            sseBuffer += chunk;
            let newline;
            let changed = false;
            while ((newline = sseBuffer.indexOf("\n")) !== -1) {
                const line = sseBuffer.slice(0, newline).trim();
                sseBuffer = sseBuffer.slice(newline + 1);
                if (!line.startsWith("data:")) continue; // skips ": OPENROUTER PROCESSING" keep-alives
                const data = line.slice(5).trim();
                if (data === "[DONE]") continue;
                let json;
                try { json = JSON.parse(data); } catch (_) { continue; }
                if (json.error) {
                    fail(`OpenRouter error: ${json.error.message || JSON.stringify(json.error)}`);
                    return false;
                }
                const choice = json.choices?.[0];
                if (!choice) continue;
                if (choice.finish_reason) finishReason = choice.finish_reason;
                const delta = choice.delta || {};
                if (delta.content) {
                    accumulatedText += delta.content;
                    changed = true;
                } else if ((delta.reasoning || delta.reasoning_details) && !accumulatedText && !thinkingShown) {
                    thinkingShown = true;
                    emit("UGH_Response_Loading", { message: "Thinking..." });
                }
            }
            if (changed && analysisId === currentAnalysisId) emit("UGH_Response_Progress", { text: accumulatedText });
            return true;
        };

        let streamStarted = false;

        try {
            currentRequest = GM_xmlhttpRequest({
                method: "POST",
                url: OPENROUTER_URL,
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`,
                    "X-Title": "Ultimate Gemini Helper"
                },
                data: JSON.stringify(payload),
                responseType: "stream",
                timeout: 180000,
                onreadystatechange: async (response) => {
                    if (analysisId !== currentAnalysisId || streamStarted) return;
                    if (response.readyState < 2 || !response.response) return;
                    if (typeof response.response.getReader !== "function") return; // no stream support, onload handles it
                    streamStarted = true;

                    const reader = response.response.getReader();
                    const decoder = new TextDecoder();
                    const isError = response.status < 200 || response.status >= 300;
                    let errorBody = "";

                    try {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            if (analysisId !== currentAnalysisId) {
                                reader.cancel().catch(() => {});
                                return;
                            }
                            const chunk = decoder.decode(value, { stream: true });
                            if (isError) errorBody += chunk;
                            else if (!consumeSse(chunk)) {
                                reader.cancel().catch(() => {});
                                return;
                            }
                        }
                        if (isError) fail(describeHttpError(response.status, errorBody));
                        else {
                            consumeSse("\n");
                            finish();
                        }
                    } catch (err) {
                        GM_log("UGH: Stream reading error", err);
                        fail("Stream reading error.");
                    }
                },
                onload: (response) => {
                    // Fallback for script managers that don't support responseType "stream"
                    if (streamStarted || analysisId !== currentAnalysisId) return;
                    if (response.status < 200 || response.status >= 300) {
                        fail(describeHttpError(response.status, response.responseText));
                        return;
                    }
                    if (consumeSse((response.responseText || "") + "\n")) finish();
                },
                onerror: (response) => {
                    GM_log("UGH: Network error", response);
                    fail(`Network error: ${response?.statusText || response?.error || "could not reach OpenRouter"}`);
                },
                ontimeout: () => fail("Request timed out.")
            });
        } catch (error) {
            GM_log("UGH: Error initiating request:", error);
            fail(error.message || "Failed to initiate analysis.");
        }
    };

    /* =====================================================================
     *  INTERNAL EVENTS
     *  Plain function calls inside the userscript sandbox. Nothing is
     *  dispatched on window, so the page can't trigger requests or read
     *  answers.
     * ===================================================================== */

    const uiHandlers = {};
    const emit = (eventName, detail) => uiHandlers[eventName]?.(detail);

    /* =====================================================================
     *  EVENT FIREWALL
     *  Events on our UI (typing in the popup/settings, clicks, mouse moves,
     *  paste...) normally travel window -> document -> ... -> our element, so
     *  page listeners on window/document would see them first, including
     *  key presses and pasted text. Session-replay/analytics scripts record
     *  exactly that.
     *
     *  These listeners are registered at document-start on window in the
     *  capture phase, so they run before any page listener. For an event
     *  aimed at our UI they:
     *    1. stop it right there, so no page listener ever receives it, and
     *    2. re-dispatch a private copy (composed: false, so it can't leave our
     *       closed shadow root) to the element inside our UI it was meant for.
     *  Default actions (typing, caret movement, scrolling, opening links)
     *  still happen, because propagation was stopped, not the default.
     *  The trade-off: the private copies have isTrusted === false (our code
     *  doesn't check it).
     * ===================================================================== */

    // Every event type the browser knows (all on* handlers on window, document and
    // elements) plus types without an on* property. A hand-written list missed
    // legacy/new events like Chrome's "textInput" (carries typed text) and
    // "pointerrawupdate" (mouse movement). Only events whose target is our host
    // are touched, so blocking everything aimed at it is safe.
    const FIREWALL_EVENTS = (() => {
        const types = new Set([
            "focusin", "focusout", "compositionstart", "compositionupdate", "compositionend", "textInput",
            "beforeinput", "selectstart", "selectionchange", "copy", "cut", "paste", "beforecopy", "beforecut", "beforepaste",
            "mouseenter", "mouseleave", "DOMMouseScroll", "MozMousePixelScroll",
            "gotpointercapture", "lostpointercapture", "pointerrawupdate", "scrollend"
        ]);
        for (const obj of [window, document, document.documentElement]) {
            for (let o = obj; o; o = Object.getPrototypeOf(o)) {
                for (const k of Object.getOwnPropertyNames(o)) if (k.startsWith("on")) types.add(k.slice(2));
            }
        }
        return [...types];
    })();
    // Only the types our own handlers listen for need a private copy.
    const REDISPATCH_EVENTS = new Set([
        "keydown", "keyup", "keypress", "click", "contextmenu", "pointerdown", "pointermove", "pointerup", "pointercancel"
    ]);
    const EVENT_INIT_PROPS = [
        "detail", "screenX", "screenY", "clientX", "clientY", "button", "buttons",
        "ctrlKey", "shiftKey", "altKey", "metaKey", "key", "code", "location", "repeat", "isComposing",
        "pointerId", "pointerType", "isPrimary", "width", "height", "pressure"
    ];

    const capturedPointers = new Map(); // pointerId -> element in our UI that captured it
    const capturePointer = (el, pointerId) => {
        N.setPointerCapture.call(el, pointerId);
        capturedPointers.set(pointerId, el);
    };

    // From window, a closed shadow root hides the real target, so work it out ourselves.
    const innerTargetFor = (e) => {
        if (!uiRoot) return null;
        if (e.type.startsWith("key")) return uiRoot.activeElement;
        if (e.pointerId !== undefined && capturedPointers.has(e.pointerId)) return capturedPointers.get(e.pointerId);
        if (typeof e.clientX === "number" && (e.clientX || e.clientY || e.detail)) return uiRoot.elementFromPoint(e.clientX, e.clientY);
        return uiRoot.activeElement; // keyboard-activated click
    };

    // Clicking our buttons/overlay must not pull focus off the page; only text
    // fields, dropdowns and the answer text (so it can be selected) take focus.
    const takesFocus = (el) => !!el?.closest?.("input, select, textarea, .ugh-popup-body");

    const firewall = (e) => {
        if (!uiHost || e.target !== uiHost) return; // not ours: leave the page's events alone
        const inner = innerTargetFor(e);

        if (e.type === "mousedown" && !takesFocus(inner)) N.preventDefault.call(e);
        N.stopImmediatePropagation.call(e);

        if (inner && REDISPATCH_EVENTS.has(e.type)) {
            const init = { bubbles: true, cancelable: true, composed: false };
            for (const p of EVENT_INIT_PROPS) if (p in e) init[p] = e[p];
            const copy = new e.constructor(e.type, init);
            N.dispatchEvent.call(inner, copy);
            if (copy.defaultPrevented) N.preventDefault.call(e);
        }
        if (e.type === "pointerup" || e.type === "pointercancel" || e.type === "lostpointercapture") {
            capturedPointers.delete(e.pointerId);
        }
    };

    // Global keys (registered first, so it sees keys before the firewall and the page):
    // - the capture hotkey is consumed so it doesn't also trigger a site shortcut
    // - while the capture overlay is open, every key is ours (Esc cancels)
    const onGlobalKey = (e) => {
        if (captureActive) {
            N.preventDefault.call(e);
            N.stopImmediatePropagation.call(e);
            if (e.type === "keydown" && e.key === "Escape") cancelActiveCapture?.();
            return;
        }
        if (e.type === "keydown" && isCaptureHotkey(e)) {
            N.preventDefault.call(e);
            N.stopImmediatePropagation.call(e);
            swallowHotkeyKeyup = true;
            startRegionCapture();
        } else if (e.type === "keyup" && swallowHotkeyKeyup && e.code === "KeyS") {
            swallowHotkeyKeyup = false;
            N.preventDefault.call(e);
            N.stopImmediatePropagation.call(e);
        }
    };
    listen(realWindow, "keydown", onGlobalKey, true);
    listen(realWindow, "keyup", onGlobalKey, true);
    for (const type of FIREWALL_EVENTS) listen(realWindow, type, firewall, true);

    /* =====================================================================
     *  UI
     * ===================================================================== */

    const ICONS = {
        psychology: `<svg xmlns="http://www.w3.org/2000/svg" enable-background="new 0 0 24 24" height="28px" viewBox="0 0 24 24" width="28px" fill="#e3e3e3"><g><rect fill="none" height="24" width="24"/></g><g><g><path d="M15.82,7.22l-1,0.4c-0.21-0.16-0.43-0.29-0.67-0.39L14,6.17C13.98,6.07,13.9,6,13.8,6h-1.6c-0.1,0-0.18,0.07-0.19,0.17 l-0.15,1.06c-0.24,0.1-0.47,0.23-0.67,0.39l-1-0.4c-0.09-0.03-0.2,0-0.24,0.09l-0.8,1.38c-0.05,0.09-0.03,0.2,0.05,0.26l0.85,0.66 C10.02,9.73,10,9.87,10,10c0,0.13,0.01,0.26,0.03,0.39l-0.84,0.66c-0.08,0.06-0.1,0.17-0.05,0.25l0.8,1.39 c0.05,0.09,0.15,0.12,0.25,0.09l0.99-0.4c0.21,0.16,0.43,0.29,0.68,0.39L12,13.83c0.02,0.1,0.1,0.17,0.2,0.17h1.6 c0.1,0,0.18-0.07,0.2-0.17l0.15-1.06c0.24-0.1,0.47-0.23,0.67-0.39l0.99,0.4c0.09,0.04,0.2,0,0.24-0.09l0.8-1.39 c0.05-0.09,0.03-0.19-0.05-0.25l-0.83-0.66C15.99,10.26,16,10.13,16,10c0-0.14-0.01-0.27-0.03-0.39l0.85-0.66 c0.08-0.06,0.1-0.17,0.05-0.26l-0.8-1.38C16.02,7.22,15.91,7.19,15.82,7.22z M13,11.43c-0.79,0-1.43-0.64-1.43-1.43 S12.21,8.57,13,8.57s1.43,0.64,1.43,1.43S13.79,11.43,13,11.43z"/><path d="M19.94,9.06c-0.43-3.27-3.23-5.86-6.53-6.05C13.27,3,13.14,3,13,3C9.47,3,6.57,5.61,6.08,9l-1.93,3.48 C3.74,13.14,4.22,14,5,14h1v2c0,1.1,0.9,2,2,2h1v3h7v-4.68C18.62,15.07,20.35,12.24,19.94,9.06z M14.89,14.63L14,15.05V19h-3v-3H8 v-4H6.7l1.33-2.33C8.21,7.06,10.35,5,13,5c2.76,0,5,2.24,5,5C18,12.09,16.71,13.88,14.89,14.63z"/></g></g></svg>`,
        close: `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/></svg>`,
        copy: `<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 0 24 24" width="18px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`,
        check: `<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 0 24 24" width="18px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>`,
        crop: `<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 0 24 24" width="18px" fill="currentColor"><path d="M0 0h24v24H0z" fill="none"/><path d="M17 15h2V7c0-1.1-.9-2-2-2H9v2h8v8zM7 17V1H5v4H1v2h4v10c0 1.1.9 2 2 2h10v4h2v-4h4v-2H7z"/></svg>`,
        send: `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`
    };

    // Fonts must be declared at document level to be usable inside a shadow root.
    GM_addStyle("@import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap');");

    // All UI lives in a closed shadow root: page CSS can't restyle (or misalign) it,
    // and page scripts can't query into it.
    const UI_CSS = `
        :host { all: initial; }
        *, *::before, *::after { box-sizing: border-box; }
        button {
            margin: 0; padding: 0; border: none; background: none; font: inherit; color: inherit;
            line-height: 1; text-transform: none; letter-spacing: normal; min-width: 0; min-height: 0;
            -webkit-appearance: none; appearance: none;
        }
        svg { display: block; flex-shrink: 0; }
        #ugh-ui { font-family: 'Roboto', Arial, sans-serif; color: #202124; line-height: normal; font-size: 14px; }

        /* Floating UI Container */
        #ugh-floating-container { position: fixed; bottom: 20px; left: 20px; z-index: 2147483645; }

        #ugh-floating-trigger {
            width: 56px; height: 56px; flex-shrink: 0; padding: 0;
            background: #1a73e8; color: white; border-radius: 16px; border: none;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3); cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            transition: transform 0.2s, background 0.2s; z-index: 2; position: relative;
        }
        #ugh-floating-trigger:hover { transform: scale(1.05); background: #1557b0; }

        /* Hover Menu */
        #ugh-hover-menu {
            position: absolute; left: 68px; bottom: 0;
            opacity: 0; visibility: hidden; transform: translateX(-15px);
            transition: all 0.2s cubic-bezier(0.4, 0.0, 0.2, 1);
            background: white; border-radius: 12px; padding: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15); border: 1px solid #dadce0;
            width: 260px; display: flex; flex-direction: column; gap: 10px; z-index: 1;
        }
        /* Invisible bridge over the gap so the mouse doesn't lose hover */
        #ugh-hover-menu::before {
            content: ''; position: absolute; left: -20px; top: 0; bottom: 0; width: 20px; background: transparent;
        }
        #ugh-floating-trigger:hover ~ #ugh-hover-menu,
        #ugh-hover-menu:hover,
        #ugh-hover-menu:focus-within { opacity: 1; visibility: visible; transform: translateX(0); }

        .ugh-menu-btn {
            background: #f1f3f4; border: none; padding: 8px 12px; border-radius: 8px;
            cursor: pointer; font-family: 'Roboto', sans-serif; font-size: 13px; font-weight: 500;
            color: #3c4043; display: flex; align-items: center; gap: 8px; width: 100%;
            transition: background 0.2s;
        }
        .ugh-menu-btn:hover { background: #e8eaed; color: #1a73e8; }
        .ugh-menu-btn svg { fill: currentColor; }

        .ugh-menu-input {
            width: 100%; padding: 8px; border: 1px solid #dadce0; border-radius: 6px;
            font-size: 12px; box-sizing: border-box; margin-bottom: 4px; font-family: 'Roboto', sans-serif;
        }
        .ugh-menu-input.ugh-secret { -webkit-text-security: disc; }
        .ugh-menu-input.ugh-secret:focus { -webkit-text-security: none; }
        .ugh-menu-label { font-size: 11px; color: #5f6368; font-weight: 700; text-transform: uppercase; }
        .ugh-menu-link { margin-left: 6px; font-weight: 400; text-transform: none; color: #1a73e8; }

        /* Popup */
        .ugh-response-popup {
            position: fixed; top: 20px; right: 20px; background: #ffffff; color: #202124;
            border-radius: 16px; padding: 0; z-index: 999999; width: 400px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.15); font-family: 'Roboto', sans-serif;
            display: flex; flex-direction: column; animation: slideInRight 0.3s ease-out;
            overflow: hidden; border: 1px solid #dadce0;
        }
        .ugh-popup-header {
            display: flex; justify-content: space-between; align-items: center;
            padding: 12px 16px; background: #f8f9fa; border-bottom: 1px solid #dadce0;
        }
        .ugh-popup-title { font-weight: 500; font-size: 14px; color: #5f6368; }
        .ugh-popup-close { background: none; border: none; cursor: pointer; color: #5f6368; display:flex; align-items:center; }
        .ugh-popup-close:hover { color: #202124; }
        .ugh-popup-body { padding: 20px; max-height: 80vh; overflow-y: auto; font-size: 14px; line-height: 1.6; color: #3c4043; }

        /* Rich Text */
        .ugh-answer-box {
            background: #e8f0fe; color: #1967d2; padding: 16px; border-radius: 12px;
            margin-bottom: 20px; font-size: 18px; font-weight: 500; line-height: 1.4;
            border-left: 5px solid #1967d2;
        }
        .ugh-explanation-text strong { font-weight: 700; color: #202124; }
        .ugh-explanation-text em { font-style: italic; color: #5f6368; }
        .ugh-explanation-text code { background: #f1f3f4; padding: 2px 4px; border-radius: 4px; font-family: monospace; color: #d93025; }
        .ugh-explanation-text ul { padding-left: 20px; margin: 8px 0; }
        .ugh-explanation-text li { margin-bottom: 4px; }
        .ugh-explanation-text h3 { font-size: 15px; font-weight: 700; margin: 16px 0 8px 0; color: #202124; }
        .ugh-loading-spinner { width: 32px; height: 32px; border: 3px solid #e0e0e0; border-top: 3px solid #1a73e8; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto; }
        @keyframes slideInRight { from { transform: translateX(400px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

        .ugh-popup-footer {
            padding: 12px 16px; border-top: 1px solid #dadce0; background: #f8f9fa;
            display: flex; gap: 8px; align-items: center;
        }
        .ugh-popup-input {
            flex: 1; padding: 10px 16px; border: 1px solid #dadce0; border-radius: 24px;
            font-family: 'Roboto', sans-serif; font-size: 14px; outline: none; transition: border-color 0.2s;
        }
        .ugh-popup-input:focus { border-color: #1a73e8; }
        .ugh-popup-send {
            background: #1a73e8; color: white; border: none; border-radius: 50%;
            width: 40px; height: 40px; cursor: pointer; display: flex;
            align-items: center; justify-content: center; transition: background 0.2s; flex-shrink: 0;
        }
        .ugh-popup-send:hover { background: #1557b0; }
        .ugh-popup-send svg { fill: currentColor; width: 20px; height: 20px; }

        /* Region capture */
        #ugh-capture-overlay {
            position: fixed; inset: 0; z-index: 2147483647; cursor: crosshair;
            background: rgba(0,0,0,0.25); user-select: none; touch-action: none;
        }
        #ugh-capture-box {
            position: fixed; display: none; border: 2px solid #1a73e8;
            background: rgba(26,115,232,0.08); box-shadow: 0 0 0 9999px rgba(0,0,0,0.25);
            pointer-events: none;
        }
        #ugh-capture-overlay.ugh-dragging { background: transparent; }
        #ugh-capture-hint {
            position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
            background: #202124; color: #fff; padding: 8px 14px; border-radius: 8px;
            font: 500 13px 'Roboto', sans-serif; pointer-events: none;
        }
        select.ugh-menu-input { -webkit-appearance: auto; appearance: auto; background: #fff; }

        /* Math (KaTeX MathML output) */
        math { font-size: 1.15em; }
        .katex-display { display: block; margin: 10px 0; overflow-x: auto; overflow-y: hidden; text-align: center; }
        .katex-display > .katex { display: block; }
        .ugh-math-raw { font-family: monospace; color: #d93025; background: #f1f3f4; padding: 6px 8px; border-radius: 6px; margin: 8px 0; white-space: pre-wrap; }
    `;

    // Shadow host, created at document-start (before page scripts) and attached
    // to <html> so it survives SPA body swaps. If a page removes it, the same
    // host (and everything inside it) is re-attached.
    let uiRoot = null;
    let uiHost = null;
    const getUiRoot = () => {
        if (!uiRoot) {
            uiHost = mk("ugh-root");
            uiHost.id = "ugh-root";
            uiHost.style.cssText = "all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;";
            uiRoot = N.attachShadow.call(uiHost, { mode: "closed" });
            const style = mk("style");
            style.textContent = UI_CSS;
            const wrapper = mk("div");
            wrapper.id = "ugh-ui";
            uiRoot.append(style, wrapper);
        }
        if (!uiHost.isConnected) document.documentElement.appendChild(uiHost);
        return uiRoot;
    };
    const uiMount = (el) => getUiRoot().getElementById("ugh-ui").appendChild(el);
    const uiFind = (id) => (uiRoot ? uiRoot.getElementById(id) : null);

    // --- Selection ---
    const getSelectionData = () => {
        const selection = window.getSelection();
        const text = selection.toString().trim();
        const images = [];
        if (selection.rangeCount > 0) {
            const div = mk("div");
            div.appendChild(selection.getRangeAt(0).cloneContents());
            div.querySelectorAll("img").forEach((img) => {
                if (img.src && !img.src.startsWith("data:")) images.push(img.src);
            });
        }
        return { text, images };
    };

    // --- Floating button + settings menu ---
    const createFloatingUI = () => {
        const container = mk("div");
        container.id = "ugh-floating-container";

        const triggerBtn = mk("button");
        triggerBtn.id = "ugh-floating-trigger";
        setHTML(triggerBtn, ICONS.psychology);
        triggerBtn.title = "Click to Ask AI | Hover for Settings";
        triggerBtn.onclick = () => {
            const { text, images } = getSelectionData();
            if (text || images.length > 0) performAnalysis(text, images);
            else showNotice("Highlight text or images on the page first, or use Capture Area (" + CAPTURE_HOTKEY_LABEL + ").");
        };

        const menu = mk("div");
        menu.id = "ugh-hover-menu";

        const copyBtn = mk("button");
        copyBtn.className = "ugh-menu-btn";
        setHTML(copyBtn, `${ICONS.copy} Copy Prompt`);
        copyBtn.onclick = () => {
            const { text, images } = getSelectionData();
            if (!text && images.length === 0) return showNotice("Highlight text or images on the page first.");
            GM_setClipboard(buildPrompt(text, images.length > 0));
            setHTML(copyBtn, `${ICONS.check} Copied!`);
            setTimeout(() => setHTML(copyBtn, `${ICONS.copy} Copy Prompt`), 2000);
        };
        menu.appendChild(copyBtn);

        const captureBtn = mk("button");
        captureBtn.className = "ugh-menu-btn";
        setHTML(captureBtn, `${ICONS.crop} Capture Area <span style="margin-left:auto;color:#80868b;font-weight:400">${CAPTURE_HOTKEY_LABEL}</span>`);
        captureBtn.onclick = () => startRegionCapture();
        menu.appendChild(captureBtn);

        menu.appendChild(mk("hr")).style = "border:0; border-top:1px solid #eee; margin:8px 0";

        const addLabel = (text) => {
            const label = mk("div");
            label.className = "ugh-menu-label";
            label.innerText = text;
            menu.appendChild(label);
            return label;
        };
        const addInput = (placeholder, secret = false) => {
            const el = mk("input");
            el.className = "ugh-menu-input" + (secret ? " ugh-secret" : "");
            el.type = "text"; // Prevent password save prompt
            el.placeholder = placeholder;
            el.autocomplete = "off";
            el.spellcheck = false;
            el.setAttribute("data-lpignore", "true");
            menu.appendChild(el);
            return el;
        };

        const keyLabel = addLabel("OpenRouter API Key");
        const keyLink = mk("a");
        keyLink.href = "https://openrouter.ai/keys";
        keyLink.target = "_blank";
        keyLink.rel = "noopener noreferrer";
        keyLink.innerText = "get one";
        keyLink.className = "ugh-menu-link";
        keyLabel.appendChild(keyLink);
        const keyInput = addInput("sk-or-v1-...", true);

        addLabel("Model");
        const modelInput = addInput(DEFAULT_MODEL);

        addLabel("Screenshot Mode");
        const modeSelect = mk("select");
        modeSelect.className = "ugh-menu-input";
        setHTML(modeSelect, `
            <option value="exact">Exact (asks to share tab once)</option>
            <option value="fast">Fast (no prompt, may miss iframes/LaTeX)</option>`);
        modeSelect.value = getCaptureMode();
        modeSelect.onchange = () => {
            saveSettings({ captureMode: modeSelect.value });
            if (modeSelect.value === "fast") stopTabCapture(); // end any open tab share
        };
        menu.appendChild(modeSelect);

        const refreshInputs = () => {
            setVal(keyInput, "");
            keyInput.placeholder = getApiKey() ? `Saved: ${getKeyHint()} (paste to replace)` : "sk-or-v1-...";
            const model = getModel();
            setVal(modelInput, model !== DEFAULT_MODEL ? model : "");
        };
        refreshInputs();

        const saveBtn = mk("button");
        saveBtn.className = "ugh-menu-btn";
        saveBtn.style = "justify-content:center; background:#1a73e8; color:white";
        saveBtn.innerText = "Save";
        saveBtn.onclick = () => {
            saveSettings({ key: getVal(keyInput), model: getVal(modelInput) });
            refreshInputs();
            saveBtn.innerText = "Saved!";
            setTimeout(() => (saveBtn.innerText = "Save"), 1500);
        };
        menu.appendChild(saveBtn);

        const clearBtn = mk("button");
        clearBtn.className = "ugh-menu-btn";
        clearBtn.style = "justify-content:center";
        clearBtn.innerText = "Clear Chat History & Cache";
        clearBtn.onclick = () => {
            clearHistoryAndCache();
            clearBtn.innerText = "Cleared!";
            setTimeout(() => (clearBtn.innerText = "Clear Chat History & Cache"), 1500);
        };
        menu.appendChild(clearBtn);

        container.appendChild(triggerBtn);
        container.appendChild(menu);
        uiMount(container);
    };

    // --- Response popup ---
    const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // --- LaTeX ---
    // Rendered with KaTeX as MathML, which the browser draws natively: no KaTeX
    // CSS or web fonts are fetched, so page CSP/CORS rules can't break it.
    const MATH_PATTERNS = [
        { re: /\\\[([\s\S]+?)\\\]/g, display: true },               // \[ ... \]
        { re: /\$\$([\s\S]+?)\$\$/g, display: true },               // $$ ... $$
        { re: /\\\(([\s\S]+?)\\\)/g, display: false },              // \( ... \)
        { re: /\$(?![\s$])([^$\n]+?)(?<!\s)\$(?!\d)/g, display: false } // $ ... $ (not "$5 and $10")
    ];

    const renderMath = (tex, display) => {
        if (typeof katex !== "undefined") {
            try {
                return katex.renderToString(tex, { displayMode: display, output: "mathml", throwOnError: true, strict: "ignore" });
            } catch (_) { /* malformed LaTeX: fall through to showing the source */ }
        }
        const src = escapeHtml(display ? `\\[${tex}\\]` : `\\(${tex}\\)`);
        return display ? `<div class="ugh-math-raw">${src}</div>` : `<code>${src}</code>`;
    };

    // Swaps math for placeholders so the markdown regexes below don't mangle it.
    const extractMath = (text) => {
        const blocks = [];
        for (const { re, display } of MATH_PATTERNS) {
            text = text.replace(re, (_, tex) => {
                blocks.push(renderMath(tex.trim(), display));
                return display ? `\u0000D${blocks.length - 1}\u0000` : `\u0000I${blocks.length - 1}\u0000`;
            });
        }
        return { text, blocks };
    };

    const restoreMath = (html, blocks) => html
        .replace(/(?:<br>\s*)*\u0000D(\d+)\u0000(?:\s*<br>)*/g, (_, i) => blocks[i]) // display math is already a block
        .replace(/\u0000I(\d+)\u0000/g, (_, i) => blocks[i]);

    const formatRichText = (text) => {
        if (!text) return "";
        const math = extractMath(text);
        let html = escapeHtml(math.text)
            .replace(/^### (.*$)/gim, "<h3>$1</h3>")
            .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
            .replace(/(\*|_)(.*?)\1/g, "<em>$2</em>")
            .replace(/`(.*?)`/g, "<code>$1</code>")
            .replace(/^\s*[-*]\s+(.*)$/gm, "<li>$1</li>")
            .replace(/\n/g, "<br>");
        html = html.replace(/(<li>.*<\/li>)/g, "<ul>$1</ul>").replace(/<\/ul><br><ul>/g, "");
        return restoreMath(html, math.blocks);
    };

    const showResponsePopup = (contentHTML, isLoading = false) => {
        let popup = uiFind("ugh-gemini-popup");
        const bodyContent = isLoading
            ? `<div class="ugh-loading-spinner"></div><div style="text-align:center;margin-top:10px;color:#5f6368">${contentHTML}</div>`
            : contentHTML;

        if (popup) {
            setHTML(popup.querySelector(".ugh-popup-body"), bodyContent);
            return;
        }

        popup = mk("div");
        popup.id = "ugh-gemini-popup";
        popup.className = "ugh-response-popup";
        setHTML(popup, `
            <div class="ugh-popup-header">
                <span class="ugh-popup-title">Gemini Assistant</span>
                <button class="ugh-popup-close">${ICONS.close}</button>
            </div>
            <div class="ugh-popup-body">${bodyContent}</div>
            <div class="ugh-popup-footer">
                <input type="text" class="ugh-popup-input" placeholder="Ask a follow-up..." />
                <button class="ugh-popup-send">${ICONS.send}</button>
            </div>
        `);

        // Draggable header
        const header = popup.querySelector(".ugh-popup-header");
        header.style.cursor = "move";

        const savedPos = GM_getValue(STORAGE.popupPos, null);
        if (savedPos) {
            popup.style.right = "auto";
            popup.style.left = savedPos.left;
            popup.style.top = savedPos.top;
            popup.style.animation = "none";
        }

        // Pointer capture keeps drag events on the header instead of whatever page element is under the cursor.
        header.style.touchAction = "none";
        listen(header, "pointerdown", (e) => {
            if (e.button !== 0 || e.target.closest(".ugh-popup-close")) return;
            e.preventDefault();
            capturePointer(header, e.pointerId);
            const startX = e.clientX;
            const startY = e.clientY;
            const rect = popup.getBoundingClientRect();

            popup.style.right = "auto";
            popup.style.animation = "none";
            popup.style.transform = "none";

            const onMove = (ev) => {
                popup.style.left = `${rect.left + ev.clientX - startX}px`;
                popup.style.top = `${rect.top + ev.clientY - startY}px`;
            };
            const onUp = () => {
                unlisten(header, "pointermove", onMove);
                unlisten(header, "pointerup", onUp);
                unlisten(header, "pointercancel", onUp);
                GM_setValue(STORAGE.popupPos, { left: popup.style.left, top: popup.style.top });
            };
            listen(header, "pointermove", onMove);
            listen(header, "pointerup", onUp);
            listen(header, "pointercancel", onUp);
        });

        popup.querySelector(".ugh-popup-close").onclick = () => popup.remove();

        const input = popup.querySelector(".ugh-popup-input");
        const handleSend = () => {
            const text = getVal(input).trim();
            if (!text) return;
            setVal(input, "");
            performAnalysis(text, lastImages, "/ai", true); // follow-ups depend on history, so never use the cache
        };
        popup.querySelector(".ugh-popup-send").onclick = handleSend;
        listen(input, "keypress", (e) => { if (e.key === "Enter") handleSend(); });

        uiMount(popup);
    };

    // Informational message in the popup (used instead of alert(), which is a
    // focus-stealing modal and can be overridden by page code).
    const showNotice = (message) =>
        showResponsePopup(`<div style="color: #5f6368;">${escapeHtml(message)}</div>`, false);

    const parseAndDisplay = (rawText) => {
        const answerRegex = /Correct Answer:\s*(.+?)(?=\n\n|\nExplanation:|$)/is;
        const explanationRegex = /Explanation:\s*(.+)/is;
        const answerMatch = rawText.match(answerRegex);
        const explanationMatch = rawText.match(explanationRegex);

        let answerHtml;
        if (answerMatch) {
            answerHtml = answerMatch[1].trim().split(" || ")
                .map((ans) => `<div class="ugh-answer-box">${formatRichText(ans.trim())}</div>`).join("");
        } else {
            answerHtml = `<div class="ugh-answer-box">${rawText.length < 100 ? "Analyzing..." : "Analysis Complete"}</div>`;
        }

        const explanation = explanationMatch
            ? formatRichText(explanationMatch[1].trim())
            : formatRichText(rawText.replace(answerRegex, "").trim());

        showResponsePopup(`${answerHtml}<div class="ugh-explanation-text">${explanation}</div>`, false);
    };

    uiHandlers.UGH_Response_Loading = (d) => showResponsePopup(escapeHtml(d?.message || "Analyzing..."), true);
    uiHandlers.UGH_Response_Progress = (d) => parseAndDisplay(d.text);
    uiHandlers.UGH_Response_Success = (d) => parseAndDisplay(d.text);
    uiHandlers.UGH_Response_Error = (d) =>
        showResponsePopup(`<div style="color: #d93025; font-weight: 500;">${escapeHtml(d.message)}</div>`, false);

    /* =====================================================================
     *  REGION CAPTURE (drag to select an area, send it to the model)
     *  - Hotkey is consumed so it doesn't also trigger a site shortcut.
     *  - While selecting, key presses go to us (Esc cancels) instead of the
     *    site's shortcuts, and the overlay keeps clicks/drags off the page.
     *  - The image is rendered from the DOM with html2canvas (no screen-share
     *    permission prompt). Cross-origin iframes, video and some canvases
     *    can't be captured this way and will show up blank.
     * ===================================================================== */

    const CAPTURE_PROMPT = "Answer the question(s) shown in the attached screenshot.";
    const CAPTURE_HOTKEY_LABEL = "Alt+Shift+S";
    const isCaptureHotkey = (e) => e.code === "KeyS" && e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey;

    let captureActive = false;
    let swallowHotkeyKeyup = false;
    let cancelActiveCapture = null; // closes the open overlay (called on Esc by onGlobalKey)

    const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const captureRegion = async (rect) => {
        if (typeof html2canvas !== "function") {
            throw new Error("Screenshot library failed to load. Reinstall the script or check your connection.");
        }
        const scale = Math.min(window.devicePixelRatio || 1, 2);
        const canvas = await html2canvas(document.documentElement, {
            x: rect.left + window.scrollX,
            y: rect.top + window.scrollY,
            width: rect.width,
            height: rect.height,
            scale,
            useCORS: true,
            logging: false,
            backgroundColor: getComputedStyle(document.body).backgroundColor || "#ffffff",
            ignoreElements: (el) => typeof el.id === "string" && el.id.startsWith("ugh-")
        });
        const dataUrl = N.toDataURL.call(canvas, "image/png");
        return { mimeType: "image/png", base64Data: dataUrl.slice(dataUrl.indexOf(",") + 1) };
    };

    // --- Exact mode: real pixels from a tab-capture stream ---
    // The stream is kept open after the first capture so later captures don't
    // prompt again. The browser shows a "sharing this tab" indicator while it
    // is open; clicking "Stop sharing" there ends it.
    let tabCapture = null; // { stream, video }

    const stopTabCapture = () => {
        if (!tabCapture) return;
        tabCapture.stream.getTracks().forEach((t) => t.stop());
        tabCapture = null;
    };

    const ensureTabCapture = async () => {
        if (tabCapture && tabCapture.stream.getVideoTracks()[0]?.readyState === "live") return tabCapture;
        if (!N.getDisplayMedia) throw Object.assign(new Error("Tab capture isn't supported in this browser."), { name: "NotSupportedError" });

        const stream = await N.getDisplayMedia({
            // Ask for full resolution so small text stays legible (default can be downscaled).
            video: { displaySurface: "browser", frameRate: 30, width: { ideal: 7680 }, height: { ideal: 4320 } },
            audio: false,
            preferCurrentTab: true,      // Chrome/Edge: offer "this tab" directly
            selfBrowserSurface: "include",
            surfaceSwitching: "exclude",
            monitorTypeSurfaces: "exclude"
        });
        const track = stream.getVideoTracks()[0];
        const surface = track.getSettings().displaySurface;
        if (surface && surface !== "browser") {
            stream.getTracks().forEach((t) => t.stop());
            throw new Error("Please share this tab (not a window or the whole screen), or switch Screenshot Mode to Fast.");
        }
        listen(track, "ended", () => { if (tabCapture?.stream === stream) tabCapture = null; });

        const video = mk("video"); // never attached to the page
        video.muted = true;
        video.playsInline = true;
        N.setSrcObject.call(video, stream);
        await N.play.call(video);
        tabCapture = { stream, video };
        return tabCapture;
    };

    // Waits until the stream has delivered a frame rendered after our UI was hidden.
    const waitForFreshFrame = (video) => new Promise((resolve) => {
        const timeout = setTimeout(resolve, 400);
        if (typeof video.requestVideoFrameCallback !== "function") return;
        video.requestVideoFrameCallback(() =>
            video.requestVideoFrameCallback(() => { clearTimeout(timeout); resolve(); }));
    });

    const captureRegionExact = async (rect) => {
        const { video } = await ensureTabCapture();
        uiHost.style.visibility = "hidden"; // keep our button/popup out of the shot
        try {
            await nextFrame();
            await waitForFreshFrame(video);
            const sx = video.videoWidth / window.innerWidth;
            const sy = video.videoHeight / window.innerHeight;
            const canvas = mk("canvas");
            canvas.width = Math.max(1, Math.round(rect.width * sx));
            canvas.height = Math.max(1, Math.round(rect.height * sy));
            N.drawImage.call(
                N.getContext.call(canvas, "2d"),
                video,
                rect.left * sx, rect.top * sy, rect.width * sx, rect.height * sy,
                0, 0, canvas.width, canvas.height
            );
            const dataUrl = N.toDataURL.call(canvas, "image/png");
            return { mimeType: "image/png", base64Data: dataUrl.slice(dataUrl.indexOf(",") + 1) };
        } finally {
            uiHost.style.visibility = "";
        }
    };

    const startRegionCapture = async () => {
        if (captureActive) return;
        captureActive = true;

        // Exact mode: get permission before showing the overlay (needs the
        // hotkey/click as the user gesture, and the prompt shouldn't cover the selection).
        let mode = getCaptureMode();
        if (mode === "exact") {
            try {
                await ensureTabCapture();
            } catch (err) {
                if (err?.name === "NotSupportedError") {
                    mode = "fast"; // e.g. browsers without tab capture
                } else {
                    captureActive = false;
                    if (err?.name !== "NotAllowedError") {
                        emit("UGH_Response_Error", { message: `Screenshot failed: ${err?.message || err}` });
                    }
                    return; // user declined the share prompt
                }
            }
        }

        const overlay = mk("div");
        overlay.id = "ugh-capture-overlay";
        setHTML(overlay, `<div id="ugh-capture-box"></div><div id="ugh-capture-hint">Drag to select an area &middot; Esc to cancel</div>`);
        const box = overlay.querySelector("#ugh-capture-box");

        let start = null;
        let current = null;

        const getRect = () => ({
            left: Math.min(start.x, current.x),
            top: Math.min(start.y, current.y),
            width: Math.abs(current.x - start.x),
            height: Math.abs(current.y - start.y)
        });

        // Keys while the overlay is open are handled by onGlobalKey (Esc cancels, nothing reaches the page).
        const close = () => {
            captureActive = false;
            cancelActiveCapture = null;
            overlay.remove();
        };
        cancelActiveCapture = close;

        listen(overlay, "pointerdown", (e) => {
            if (e.button !== 0) return close();
            e.preventDefault(); // no text selection / focus change on the page
            capturePointer(overlay, e.pointerId);
            start = current = { x: e.clientX, y: e.clientY };
            overlay.classList.add("ugh-dragging");
            overlay.querySelector("#ugh-capture-hint").style.display = "none";
            box.style.display = "block";
            Object.assign(box.style, { left: `${start.x}px`, top: `${start.y}px`, width: "0px", height: "0px" });
        });

        listen(overlay, "pointermove", (e) => {
            if (!start) return;
            current = { x: e.clientX, y: e.clientY };
            const r = getRect();
            Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
        });

        listen(overlay, "pointerup", async () => {
            if (!start) return;
            const rect = getRect();
            close();
            if (rect.width < 8 || rect.height < 8) return; // treat tiny drags as a cancel

            try {
                let image;
                if (mode === "exact") {
                    image = await captureRegionExact(rect);
                } else {
                    showResponsePopup("Capturing...", true);
                    await nextFrame(); // let the overlay disappear before rendering
                    image = await captureRegion(rect);
                }
                performAnalysis(CAPTURE_PROMPT, [image], "/ai");
            } catch (err) {
                GM_log("UGH: Capture failed", err);
                emit("UGH_Response_Error", { message: `Screenshot failed: ${err?.message || err}` });
            }
        });

        listen(overlay, "contextmenu", (e) => { e.preventDefault(); close(); });

        uiMount(overlay);
    };

    // --- Init ---
    if (document.documentElement) getUiRoot(); // create the shadow root now, before page scripts run
    if (document.body) createFloatingUI();
    else listen(realWindow, "DOMContentLoaded", createFloatingUI);
})();
