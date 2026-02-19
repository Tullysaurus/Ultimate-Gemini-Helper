// ==UserScript==
// @name         UGH Frontend (UI & Interaction)
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  UI for Universal Gemini Helper. Depends on UGH Backend.
// @author       Tullysaurus
// @license      GPL-3.0
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
    "use strict";

    // === ICONS (Static SVGs) ===
    const ICONS = {
        psychology: `<svg xmlns="http://www.w3.org/2000/svg" enable-background="new 0 0 24 24" height="28px" viewBox="0 0 24 24" width="28px" fill="#e3e3e3"><g><rect fill="none" height="24" width="24"/></g><g><g><path d="M15.82,7.22l-1,0.4c-0.21-0.16-0.43-0.29-0.67-0.39L14,6.17C13.98,6.07,13.9,6,13.8,6h-1.6c-0.1,0-0.18,0.07-0.19,0.17 l-0.15,1.06c-0.24,0.1-0.47,0.23-0.67,0.39l-1-0.4c-0.09-0.03-0.2,0-0.24,0.09l-0.8,1.38c-0.05,0.09-0.03,0.2,0.05,0.26l0.85,0.66 C10.02,9.73,10,9.87,10,10c0,0.13,0.01,0.26,0.03,0.39l-0.84,0.66c-0.08,0.06-0.1,0.17-0.05,0.25l0.8,1.39 c0.05,0.09,0.15,0.12,0.25,0.09l0.99-0.4c0.21,0.16,0.43,0.29,0.68,0.39L12,13.83c0.02,0.1,0.1,0.17,0.2,0.17h1.6 c0.1,0,0.18-0.07,0.2-0.17l0.15-1.06c0.24-0.1,0.47-0.23,0.67-0.39l0.99,0.4c0.09,0.04,0.2,0,0.24-0.09l0.8-1.39 c0.05-0.09,0.03-0.19-0.05-0.25l-0.83-0.66C15.99,10.26,16,10.13,16,10c0-0.14-0.01-0.27-0.03-0.39l0.85-0.66 c0.08-0.06,0.1-0.17,0.05-0.26l-0.8-1.38C16.02,7.22,15.91,7.19,15.82,7.22z M13,11.43c-0.79,0-1.43-0.64-1.43-1.43 S12.21,8.57,13,8.57s1.43,0.64,1.43,1.43S13.79,11.43,13,11.43z"/><path d="M19.94,9.06c-0.43-3.27-3.23-5.86-6.53-6.05C13.27,3,13.14,3,13,3C9.47,3,6.57,5.61,6.08,9l-1.93,3.48 C3.74,13.14,4.22,14,5,14h1v2c0,1.1,0.9,2,2,2h1v3h7v-4.68C18.62,15.07,20.35,12.24,19.94,9.06z M14.89,14.63L14,15.05V19h-3v-3H8 v-4H6.7l1.33-2.33C8.21,7.06,10.35,5,13,5c2.76,0,5,2.24,5,5C18,12.09,16.71,13.88,14.89,14.63z"/></g></g></svg>`,
        close: `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/></svg>`,
        copy: `<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 0 24 24" width="18px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`,
        check: `<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 0 24 24" width="18px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>`,
        send: `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`
    };

    // === STYLES ===
    GM_addStyle(`
        @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap');

        /* Floating UI Container */
        #ugh-floating-container {
            position: fixed; bottom: 20px; left: 20px;
            z-index: 999998;
            /* Flex removed to prevent container from sizing to hidden content */
        }

        #ugh-floating-trigger {
            width: 56px; height: 56px; flex-shrink: 0;
            background: #1a73e8; color: white; border-radius: 16px; border: none;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3); cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            transition: transform 0.2s, background 0.2s; z-index: 2;
            position: relative; /* Context for stacking */
        }
        #ugh-floating-trigger:hover { transform: scale(1.05); background: #1557b0; }

        /* Hover Menu */
        #ugh-hover-menu {
            position: absolute;
            left: 68px; /* 56px button + 12px gap */
            bottom: 0;
            opacity: 0; visibility: hidden;
            transform: translateX(-15px);
            transition: all 0.2s cubic-bezier(0.4, 0.0, 0.2, 1);
            background: white; border-radius: 12px; padding: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15); border: 1px solid #dadce0;
            width: 260px;
            display: flex; flex-direction: column; gap: 10px; z-index: 1;
        }

        /* Invisible Bridge to cover the gap so mouse doesn't lose focus */
        #ugh-hover-menu::before {
            content: '';
            position: absolute;
            left: -20px; /* Covers the gap between button and menu */
            top: 0; bottom: 0; width: 20px;
            background: transparent;
        }

        /* SHOW LOGIC: Show if Trigger is hovered OR Menu is hovered */
        #ugh-floating-trigger:hover ~ #ugh-hover-menu,
        #ugh-hover-menu:hover {
            opacity: 1; visibility: visible; transform: translateX(0);
        }

        /* Menu Items */
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
            font-size: 12px; box-sizing: border-box; margin-bottom: 4px;
            font-family: 'Roboto', sans-serif; -webkit-text-security: disc;
        }
        .ugh-menu-label { font-size: 11px; color: #5f6368; font-weight: 700; text-transform: uppercase; }

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
        .ugh-popup-close { background: none; border: none; cursor: pointer; color: #5f6368; display:flex; align-items:center;}
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
            font-family: 'Roboto', sans-serif; font-size: 14px; outline: none;
            transition: border-color 0.2s;
        }
        .ugh-popup-input:focus { border-color: #1a73e8; }
        .ugh-popup-send {
            background: #1a73e8; color: white; border: none; border-radius: 50%;
            width: 40px; height: 40px; cursor: pointer; display: flex;
            align-items: center; justify-content: center; transition: background 0.2s;
            flex-shrink: 0;
        }
        .ugh-popup-send:hover { background: #1557b0; }
        .ugh-popup-send svg { fill: currentColor; width: 20px; height: 20px; }
    `);

    // === SELECTION HELPER ===
    const getSelectionData = () => {
        const selection = window.getSelection();
        const text = selection.toString().trim();
        const images = [];
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const div = document.createElement('div');
            div.appendChild(range.cloneContents());
            div.querySelectorAll('img').forEach(img => {
                if (img.src && !img.src.startsWith('data:')) images.push(img.src);
            });
        }
        return { text, images };
    };

    // === COMMUNICATIONS ===
    const sendToBackend = (eventName, detail = {}) => {
        window.dispatchEvent(new CustomEvent(eventName, { detail }));
    };

    // === UI BUILDER ===
    const createFloatingUI = () => {
        const container = document.createElement('div');
        container.id = 'ugh-floating-container';

        // 1. Main Button
        const triggerBtn = document.createElement('button');
        triggerBtn.id = 'ugh-floating-trigger';
        triggerBtn.innerHTML = ICONS.psychology;
        triggerBtn.title = 'Click to Ask AI | Hover for Settings';
        triggerBtn.onclick = () => {
            const { text, images } = getSelectionData();
            if (text || images.length > 0) {
                sendToBackend('UGH_Request_Analysis', { text, images });
            } else {
                alert("Please highlight text/images on the page first.");
            }
        };

        // 2. Menu
        const menu = document.createElement('div');
        menu.id = 'ugh-hover-menu';

        // Copy Prompt Button
        const copyBtn = document.createElement('button');
        copyBtn.className = 'ugh-menu-btn';
        copyBtn.innerHTML = `${ICONS.copy} Copy Prompt`;
        copyBtn.onclick = () => {
            const { text, images } = getSelectionData();
            if (!text && images.length === 0) return alert("Select content first.");
            sendToBackend('UGH_Request_Build_Prompt', { text, hasImages: images.length > 0 });
            // Logic for copying happens in the event listener below
        };
        menu.appendChild(copyBtn);

        menu.appendChild(document.createElement('hr')).style = 'border:0; border-top:1px solid #eee; margin:8px 0';

        // Settings
        const label = document.createElement('div');
        label.className = 'ugh-menu-label';
        label.innerText = 'API Key';
        menu.appendChild(label);

        const input = document.createElement('input');
        input.className = 'ugh-menu-input';
        input.type = 'text'; // Prevent password save prompt
        input.placeholder = 'Paste Gemini API Key...';
        input.autocomplete = "off";
        input.setAttribute('data-lpignore', 'true');
        menu.appendChild(input);

        // Request current key from backend to populate
        sendToBackend('UGH_Get_Key_Request');

        const saveBtn = document.createElement('button');
        saveBtn.className = 'ugh-menu-btn';
        saveBtn.style = 'justify-content:center; background:#1a73e8; color:white';
        saveBtn.innerText = 'Save';
        saveBtn.onclick = () => {
            sendToBackend('UGH_Save_Key', { key: input.value });
            saveBtn.innerText = 'Saved!';
            setTimeout(() => saveBtn.innerText = 'Save', 1500);
        };
        menu.appendChild(saveBtn);

        // Listen for key update
        window.addEventListener('UGH_Send_Key', (e) => {
            input.value = e.detail.key;
        });

        // Listen for built prompt to copy
        window.addEventListener('UGH_Return_Built_Prompt', (e) => {
            GM_setClipboard(e.detail.prompt);
            copyBtn.innerHTML = `${ICONS.check} Copied!`;
            setTimeout(() => copyBtn.innerHTML = `${ICONS.copy} Copy Prompt`, 2000);
        });

        container.appendChild(triggerBtn);
        container.appendChild(menu);
        document.body.appendChild(container);
    };

    // === POPUP LOGIC ===
    const formatRichText = (text) => {
        if (!text) return "";
        let html = text
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/^### (.*$)/gim, '<h3>$1</h3>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/(\*|_)(.*?)\1/g, '<em>$2</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>')
            .replace(/^\s*[-*]\s+(.*)$/gm, '<li>$1</li>')
            .replace(/\n/g, '<br>');
        html = html.replace(/(<li>.*<\/li>)/g, '<ul>$1</ul>').replace(/<\/ul><br><ul>/g, '');
        return html;
    };

    const showResponsePopup = (contentHTML, isLoading = false) => {
        let popup = document.getElementById("ugh-gemini-popup");
        const bodyContent = isLoading 
            ? `<div class="ugh-loading-spinner"></div><div style="text-align:center;margin-top:10px;color:#5f6368">${contentHTML}</div>` 
            : contentHTML;

        if (popup) {
            popup.querySelector('.ugh-popup-body').innerHTML = bodyContent;
            return;
        }

        popup = document.createElement("div");
        popup.id = "ugh-gemini-popup";
        popup.className = "ugh-response-popup";

        popup.innerHTML = `
            <div class="ugh-popup-header">
                <span class="ugh-popup-title">Gemini Assistant</span>
                <button class="ugh-popup-close">${ICONS.close}</button>
            </div>
            <div class="ugh-popup-body">
                ${bodyContent}
            </div>
            <div class="ugh-popup-footer">
                <input type="text" class="ugh-popup-input" placeholder="Ask a follow-up..." />
                <button class="ugh-popup-send">${ICONS.send}</button>
            </div>
        `;
        popup.querySelector('.ugh-popup-close').onclick = () => popup.remove();

        const input = popup.querySelector('.ugh-popup-input');
        const sendBtn = popup.querySelector('.ugh-popup-send');

        const handleSend = () => {
            const text = input.value.trim();
            if (!text) return;
            input.value = '';
            sendToBackend('UGH_Request_Analysis', { text, images: [] });
        };

        sendBtn.onclick = handleSend;
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleSend();
        });

        document.body.appendChild(popup);
    };

    const parseAndDisplay = (rawText) => {
        const answerRegex = /Correct Answer:\s*(.+?)(?=\n\n|\nExplanation:|$)/is;
        const explanationRegex = /Explanation:\s*(.+)/is;
        const answerMatch = rawText.match(answerRegex);
        const explanationMatch = rawText.match(explanationRegex);
        
        let answerHtml = "";
        if (answerMatch) {
            const answers = answerMatch[1].trim().split(" || ");
            answerHtml = answers.map(ans => `<div class="ugh-answer-box">${formatRichText(ans.trim())}</div>`).join("");
        } else {
            const fallbackText = rawText.length < 100 ? "Analyzing..." : "Analysis Complete";
            answerHtml = `<div class="ugh-answer-box">${fallbackText}</div>`;
        }

        const explanation = explanationMatch ? formatRichText(explanationMatch[1].trim()) : formatRichText(rawText.replace(answerRegex, '').trim());

        const html = `${answerHtml}<div class="ugh-explanation-text">${explanation}</div>`;
        showResponsePopup(html, false);
    };

    // === LISTENERS FOR BACKEND RESPONSES ===
    window.addEventListener('UGH_Response_Loading', () => showResponsePopup("Analyzing...", true));
    window.addEventListener('UGH_Response_Success', (e) => parseAndDisplay(e.detail.text));
    window.addEventListener('UGH_Response_Progress', (e) => parseAndDisplay(e.detail.text));
    window.addEventListener('UGH_Response_Error', (e) => {
        showResponsePopup(`<div style="color: #d93025; font-weight: 500;">${e.detail.message}</div>`, false);
    });

    // === INIT ===
    if (document.body) createFloatingUI();
    else window.addEventListener("DOMContentLoaded", createFloatingUI);

})();