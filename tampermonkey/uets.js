// ==UserScript==
// @name         Universal Educational Tool Suite
// @namespace    http://tampermonkey.net/
// @version      1.5.1
// @description  A unified tool for cheating on online test sites
// @author       Nyx, Tullysaurus
// @license      GPL-3.0
// @match        https://quizizz.com/*
// @match        https://wayground.com/*
// @match        https://*.quizizz.com/*
// @match        https://*.wayground.com/*
// @grant        GM_addStyle
// @grant        GM_log
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @connect      *
// ==/UserScript==

(function () {
  "use strict";

  // === ICONS ===
  const ICONS = {
      psychology: `<svg xmlns="http://www.w3.org/2000/svg" enable-background="new 0 0 24 24" height="28px" viewBox="0 0 24 24" width="28px" fill="#e3e3e3"><g><rect fill="none" height="24" width="24"/></g><g><g><path d="M15.82,7.22l-1,0.4c-0.21-0.16-0.43-0.29-0.67-0.39L14,6.17C13.98,6.07,13.9,6,13.8,6h-1.6c-0.1,0-0.18,0.07-0.19,0.17 l-0.15,1.06c-0.24,0.1-0.47,0.23-0.67,0.39l-1-0.4c-0.09-0.03-0.2,0-0.24,0.09l-0.8,1.38c-0.05,0.09-0.03,0.2,0.05,0.26l0.85,0.66 C10.02,9.73,10,9.87,10,10c0,0.13,0.01,0.26,0.03,0.39l-0.84,0.66c-0.08,0.06-0.1,0.17-0.05,0.25l0.8,1.39 c0.05,0.09,0.15,0.12,0.25,0.09l0.99-0.4c0.21,0.16,0.43,0.29,0.68,0.39L12,13.83c0.02,0.1,0.1,0.17,0.2,0.17h1.6 c0.1,0,0.18-0.07,0.2-0.17l0.15-1.06c0.24-0.1,0.47-0.23,0.67-0.39l0.99,0.4c0.09,0.04,0.2,0,0.24-0.09l0.8-1.39 c0.05-0.09,0.03-0.19-0.05-0.25l-0.83-0.66C15.99,10.26,16,10.13,16,10c0-0.14-0.01-0.27-0.03-0.39l0.85-0.66 c0.08-0.06,0.1-0.17,0.05-0.26l-0.8-1.38C16.02,7.22,15.91,7.19,15.82,7.22z M13,11.43c-0.79,0-1.43-0.64-1.43-1.43 S12.21,8.57,13,8.57s1.43,0.64,1.43,1.43S13.79,11.43,13,11.43z"/><path d="M19.94,9.06c-0.43-3.27-3.23-5.86-6.53-6.05C13.27,3,13.14,3,13,3C9.47,3,6.57,5.61,6.08,9l-1.93,3.48 C3.74,13.14,4.22,14,5,14h1v2c0,1.1,0.9,2,2,2h1v3h7v-4.68C18.62,15.07,20.35,12.24,19.94,9.06z M14.89,14.63L14,15.05V19h-3v-3H8 v-4H6.7l1.33-2.33C8.21,7.06,10.35,5,13,5c2.76,0,5,2.24,5,5C18,12.09,16.71,13.88,14.89,14.63z"/></g></g></svg>`,
      close: `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/></svg>`,
      add: `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>`,
      remove: `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M19 13H5v-2h14v2z"/></svg>`,
      send: `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`
  };

  // === SHARED CONSTANTS ===
  const UI_MODS_ENABLED_KEY = "uets_ui_modifications_enabled";
  const CONFIG_STORAGE_KEY = "UETS_CONFIG";
  const DEFAULT_CONFIG = {
    enableTimeTakenEdit: true,
    timeTakenMin: 5067,
    timeTakenMax: 7067,
    enableTimerHijack: true,
    timerBonusPoints: 270,
    enableSpoofFullscreen: true,
    serverUrl: "https://ugh.tully-dev.com",
    includeImages: true,
    enableReactionSpam: false,
    reactionSpamCount: 1,
    reactionSpamDelay: 2000,
    enableSiteOptimizations: false
  };


  const PROFILES = {
    "True Stealth": {
      enableTimeTakenEdit: false,
      enableTimerHijack: false,
      enableSpoofFullscreen: true,
      enableReactionSpam: false,
      enableSiteOptimizations: false,
    },
    "Stealthy Extended": {
      enableTimeTakenEdit: true,
      timeTakenMin: 8000,
      timeTakenMax: 14000,
      enableTimerHijack: true,
      timerBonusPoints: 200,
      enableSpoofFullscreen: true,
      enableReactionSpam: false,
      enableSiteOptimizations: false,
    },
    "Creator's choice": {
      enableTimeTakenEdit: true,
      timeTakenMin: 6000,
      timeTakenMax: 8000,
      enableTimerHijack: true,
      timerBonusPoints: 270,
      enableSpoofFullscreen: true,
      enableReactionSpam: false,
      enableSiteOptimizations: true,
    },
    "LMAO": {
      enableTimeTakenEdit: true,
      timeTakenMin: 1000,
      timeTakenMax: 2000,
      enableTimerHijack: true,
      timerBonusPoints: 5000,
      enableSpoofFullscreen: true,
      enableReactionSpam: true,
      reactionSpamCount: 2,
      reactionSpamDelay: 500,
      enableSiteOptimizations: true,
    },
  };

  // === SHARED STATE ===
  const sharedState = {
    uiModificationsEnabled: GM_getValue(UI_MODS_ENABLED_KEY, true),
    toggleButton: null,
    geminiPopup: null,
    elementsToCleanup: [],
    observer: null,
    currentDomain: window.location.hostname,
    originalRegExpTest: RegExp.prototype.test,
    quizData: {},
    currentQuestionId: null,
    questionsPool: {},
    config: GM_getValue(CONFIG_STORAGE_KEY, DEFAULT_CONFIG),
    configGui: null,
    holdTimeout: null,
    originalTabLeaveHTML: null,
    originalStartButtonText: null,
    firstRunKey: "UETS_FIRST_RUN",
    detectedAnswers: {},
    toastDismissTimeout: null
  };

  // === SHARED STYLES ===
  GM_addStyle(`
    @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap');

    /* Popup Styles (Matched to Frontend.js) */
    .ugh-response-popup {
        position: fixed; top: 20px; right: 20px; background: #ffffff; color: #202124;
        border-radius: 16px; padding: 0; z-index: 999999; width: 400px; max-width: 90vw;
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
    .ugh-popup-body::-webkit-scrollbar { width: 8px; }
    .ugh-popup-body::-webkit-scrollbar-track { background: #f1f1f1; border-radius: 4px; }
    .ugh-popup-body::-webkit-scrollbar-thumb { background: #c1c1c1; border-radius: 4px; }
    .ugh-popup-body::-webkit-scrollbar-thumb:hover { background: #a8a8a8; }

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

    /* Toggle Button */
    #uets-toggle-ui-button {
        position: fixed; bottom: 20px; left: 20px; z-index: 10002;
        width: 56px; height: 56px;
        background: #1a73e8; color: white; border-radius: 16px; border: none;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3); cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: transform 0.2s, background 0.2s;
    }
    #uets-toggle-ui-button:hover { transform: scale(1.05); background: #1557b0; }
    #uets-toggle-ui-button.uets-mods-hidden-state {
        background: #f1f3f4; color: #5f6368; box-shadow: none; border: 1px solid #dadce0;
    }
    #uets-toggle-ui-button svg { fill: currentColor; }

    /* Question Button */
    .uets-gemini-button {
        background: #1a73e8; color: white; border: none; padding: 8px 16px;
        border-radius: 20px; font-family: 'Roboto', sans-serif; font-weight: 500;
        font-size: 14px; cursor: pointer; display: inline-flex; align-items: center;
        gap: 8px; transition: background 0.2s, box-shadow 0.2s;
        box-shadow: 0 2px 4px rgba(0,0,0,0.15);
    }
    .uets-gemini-button:hover { background: #1557b0; box-shadow: 0 4px 8px rgba(0,0,0,0.2); }
    .uets-gemini-button svg { fill: currentColor; }
    .uets-main-question-buttons-container { display: flex; justify-content: center; margin-top: 8px; }

    /* Config Modal */
    .uets-config-overlay {
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.4); z-index: 10003;
        display: flex; align-items: center; justify-content: center;
        animation: fadeIn 0.2s;
    }
    .uets-config-modal {
        background: white; border-radius: 16px; width: 500px; max-width: 90vw;
        max-height: 85vh; display: flex; flex-direction: column;
        box-shadow: 0 4px 24px rgba(0,0,0,0.2); font-family: 'Roboto', sans-serif;
        overflow: hidden;
    }
    .uets-config-header {
        padding: 16px 24px; border-bottom: 1px solid #dadce0;
        display: flex; justify-content: space-between; align-items: center;
        background: #f8f9fa;
    }
    .uets-config-title { font-size: 18px; font-weight: 500; color: #202124; }
    .uets-config-content { padding: 20px 24px; overflow-y: auto; }
    .uets-config-section { margin-bottom: 24px; }
    .uets-config-section-title {
        font-size: 12px; font-weight: 700; color: #5f6368; text-transform: uppercase;
        margin-bottom: 12px; letter-spacing: 0.5px;
    }
    .uets-config-item {
        display: flex; align-items: center; justify-content: space-between;
        margin-bottom: 16px;
    }
    .uets-config-label { font-size: 14px; color: #3c4043; }
    .uets-config-input {
        padding: 8px; border: 1px solid #dadce0; border-radius: 6px;
        font-size: 14px; width: 120px; font-family: 'Roboto', sans-serif;
    }
    .uets-config-footer {
        padding: 16px 24px; border-top: 1px solid #dadce0; background: #f8f9fa;
        display: flex; justify-content: flex-end; gap: 12px;
    }
    .uets-btn {
        padding: 8px 16px; border-radius: 6px; font-size: 14px; font-weight: 500;
        cursor: pointer; border: none; font-family: 'Roboto', sans-serif;
    }
    .uets-btn-primary { background: #1a73e8; color: white; }
    .uets-btn-primary:hover { background: #1557b0; }
    .uets-btn-secondary { background: white; color: #1a73e8; border: 1px solid #dadce0; }
    .uets-btn-secondary:hover { background: #f1f3f4; }
    
    /* Correct Answer Highlight */
    .uets-correct-answer {
        border: 2px solid #34a853 !important;
        background: rgba(52, 168, 83, 0.1) !important;
    }
    .uets-answer-indicator {
        position: absolute; top: 8px; right: 8px;
        background: #34a853; color: white; padding: 4px 8px;
        border-radius: 12px; font-size: 12px; font-weight: 700;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    .uets-streak-bonus {
        margin-left: 8px; color: #fbbc04; font-weight: 700; font-size: 14px;
    }
    .uets-testportal-invisible { opacity: 0 !important; pointer-events: auto !important; }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  `);

  // === WELCOME POPUP FOR NEW USERS ===
  const showWelcomePopup = () => {
    if (!sharedState.uiModificationsEnabled) return;

    const popup = document.createElement("div");
    popup.classList.add("ugh-response-popup");
    popup.id = "uets-welcome-popup";
    popup.style.top = "50%";
    popup.style.left = "50%";
    popup.style.transform = "translate(-50%, -50%)";
    popup.style.animation = "fadeIn 0.3s";

    const header = document.createElement("div");
    header.classList.add("ugh-popup-header");

    const title = document.createElement("span");
    title.classList.add("ugh-popup-title");
    title.textContent = "Welcome to UETS!";

    const closeButton = document.createElement("button");
    closeButton.classList.add("ugh-popup-close");
    closeButton.innerHTML = ICONS.close;
    closeButton.onclick = () => popup.remove();

    header.appendChild(title);
    header.appendChild(closeButton);
    popup.appendChild(header);

    const content = document.createElement("div");
    content.classList.add("ugh-popup-body");
    content.innerHTML = `<p>- Press the floating button (bottom-left) to activate/deactivate visual changes on the page.\n- Press and release the button 3 times within 2 seconds to open the settings menu.\n- In the settings, click on the info button on the left side of each option to get some insight into the setting.</p>`;
    popup.appendChild(content);

    document.body.appendChild(popup);
  };

  // === SHARED UTILITIES ===
  const createButton = (text, className, onClick) => Object.assign(document.createElement("button"), {
    textContent: text,
    type: "button",
    onclick: onClick,
    className
  });

  const createLink = (text, href, className, onClick) => Object.assign(document.createElement("a"), {
    textContent: text,
    href,
    target: "_blank",
    rel: "noopener noreferrer",
    className,
    onclick: onClick || null
  });

  const addQuestionButtons = (
    container,
    questionText,
    options,
    imageUrl,
    platform,
    includeGetAnswer = false,
    ddgText = "DDG",
  ) => {
    const buttonsContainer = document.createElement("div");
    buttonsContainer.classList.add("uets-main-question-buttons-container");
    sharedState.elementsToCleanup.push(buttonsContainer);

    const answerButton = createButton(
      "Ask AI",
      "uets-gemini-button uets-gemini-button-main-question",
      null // Handled by custom listeners below
    );
    answerButton.innerHTML = `${ICONS.psychology} Ask AI`;

    const handleAction = async (endpoint, forceNoImage = false) => {
        let imageData = null;
        if (imageUrl && sharedState.config.includeImages && !forceNoImage) {
          try {
            imageData = await fetchImageAsBase64(imageUrl);
          } catch (error) {
            showResponsePopup(
              `Failed to fetch image: ${error}\nProceeding with text only.`,
            );
          }
        }
        askBackend(
          questionText || "(See attached image)",
          options,
          imageData,
          platform,
          endpoint
        );
    };

    let pressTimer;
    const startPress = (e) => {
        if (e.type === 'mousedown' && e.button !== 0) return;
        pressTimer = setTimeout(() => {
            pressTimer = null;
            handleAction("/ai"); // Hold for 3s -> Generate
        }, 3000);
    };

    const endPress = (e) => {
        if (e.type === 'touchend') e.preventDefault(); // Prevent mouse emulation
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
            handleAction("/ask"); // Release before 3s -> Ask
        }
    };

    answerButton.addEventListener("mousedown", startPress);
    answerButton.addEventListener("touchstart", startPress);
    answerButton.addEventListener("mouseup", endPress);
    answerButton.addEventListener("touchend", endPress);
    answerButton.addEventListener("mouseleave", () => {
        if (pressTimer) clearTimeout(pressTimer);
    });

    buttonsContainer.appendChild(answerButton);

    if (imageUrl) {
        const noImageButton = createButton(
            "Ask AI (No Image)",
            "uets-gemini-button uets-gemini-button-no-image",
            null
        );
        noImageButton.innerHTML = `${ICONS.psychology} No Image`;
        noImageButton.style.marginLeft = "8px";

        let pressTimerNoImg;
        const startPressNoImg = (e) => {
            if (e.type === 'mousedown' && e.button !== 0) return;
            pressTimerNoImg = setTimeout(() => {
                pressTimerNoImg = null;
                handleAction("/ai", true);
            }, 3000);
        };

        const endPressNoImg = (e) => {
            if (e.type === 'touchend') e.preventDefault();
            if (pressTimerNoImg) {
                clearTimeout(pressTimerNoImg);
                pressTimerNoImg = null;
                handleAction("/ask", true);
            }
        };

        noImageButton.addEventListener("mousedown", startPressNoImg);
        noImageButton.addEventListener("touchstart", startPressNoImg);
        noImageButton.addEventListener("mouseup", endPressNoImg);
        noImageButton.addEventListener("touchend", endPressNoImg);
        noImageButton.addEventListener("mouseleave", () => {
            if (pressTimerNoImg) clearTimeout(pressTimerNoImg);
        });

        buttonsContainer.appendChild(noImageButton);
    }

    container.appendChild(buttonsContainer);
  };

  const processProceedGameRequest = (data) => {
    if (data.response && data.response.timeTaken !== undefined && sharedState.config.enableTimeTakenEdit) {
      const oldtimetaken = data.response.timeTaken;
      const timetakenforce =
        Math.floor(Math.random() * (sharedState.config.timeTakenMax - sharedState.config.timeTakenMin + 1)) + sharedState.config.timeTakenMin;
      data.response.timeTaken = timetakenforce;

      if (sharedState.config.enableTimerHijack) {
        data.response.provisional.scoreBreakups.correct.timer = sharedState.config.timerBonusPoints;
        data.response.provisional.scoreBreakups.correct.total = sharedState.config.timerBonusPoints + data.response.provisional.scoreBreakups.correct.base + data.response.provisional.scoreBreakups.correct.streak;
        data.response.provisional.scores.correct = sharedState.config.timerBonusPoints + data.response.provisional.scoreBreakups.correct.base + data.response.provisional.scoreBreakups.correct.streak;
      }
      GM_log(
        `[+] timeTaken modified from ${oldtimetaken} to ${timetakenforce}`,
      );
    }
    return data;
  };

  const processProceedGameResponse = (data) => {
    const responseData = data?.response || data?.data?.response;
    const questionData = data?.question || data?.data?.question;
    if (!responseData || !questionData) {
      GM_log("[!] Could not extract response/question data");
      return;
    }
    const questionId = responseData.questionId;
    const questionType = questionData.type;
    let correctAnswer = questionData.structure?.answer;
    if (correctAnswer === 0 && questionData.structure?.options?.[0]) {
      correctAnswer = questionData.structure.options[0].text;
    }
    GM_log(`[*] Sending correct answer (${questionId} <${correctAnswer}>) to server`);
    sendAnswerToServer(questionId, correctAnswer, questionType);
  };

  // === SPOOF FULLSCREEN AND FOCUS ===
  const spoofFullscreenAndFocus = () => {
    // Spoof fullscreen properties
    Object.defineProperty(document, "fullscreenElement", {
      get: () => document.documentElement,
      configurable: true,
    });
    Object.defineProperty(document, "fullscreen", {
      get: () => true,
      configurable: true,
    });

    // Spoof focus properties - hasFocus is a method
    Object.defineProperty(document, "hasFocus", {
      value: () => true,
      writable: true,
      configurable: true,
    });

    // Override window.focus to do nothing
    window.focus = () => { };

    // Spoof visibility state
    Object.defineProperty(document, "visibilityState", {
      get: () => "visible",
      configurable: true,
    });

    // Prevent visibilitychange events from firing or handle them
    const originalDispatchEvent = document.dispatchEvent;
    document.dispatchEvent = function (event) {
      if (event.type === "visibilitychange") {
        // Suppress or modify visibilitychange events
        return true;
      }
      return originalDispatchEvent.call(this, event);
    };

    // Remove toast manager to prevent spam
    const removeToastManager = () => {
      const toastManager = document.querySelector(".toast-manager");
      if (toastManager) toastManager.remove();
    };

    // Observe for toast manager
    const toastObserver = new MutationObserver(() => {
      removeToastManager();
    });
    toastObserver.observe(document.body, { childList: true, subtree: true });

    // Initial check
    removeToastManager();

    GM_log("[+] Fullscreen and focus spoofing enabled.");
  };

  // === SERVER COMMUNICATION ===
  const postToServer = (endpoint, data) => {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: `${sharedState.config.serverUrl}${endpoint}`,
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify(data),
        onload: (response) => {
          try {
            resolve(response.status >= 200 && response.status < 300 ? JSON.parse(response.responseText) : null);
          } catch (e) {
            GM_log(`[!] Error parsing response from ${endpoint}:`, e);
            resolve(null);
          }
        },
        onerror: (error) => {
          GM_log(`[!] Error posting to ${endpoint}:`, error);
          resolve(null);
        }
      });
    });
  };

  const sendQuestionToServer = (questionId, questionType, answerIds) => null

  const sendAnswerToServer = (questionId, correctAnswers, answerType = null) => null

  // === ANSWER HIGHLIGHTING ===
  const highlightCorrectAnswers = (correctAnswers, questionType) => {
    if (!sharedState.uiModificationsEnabled) return;

    const optionButtons = document.querySelectorAll("button.option");
    optionButtons.forEach((button) => {
      button.classList.remove("uets-correct-answer");
      button.querySelector(".uets-answer-indicator")?.remove();
    });

    const currentQuestion = sharedState.questionsPool[sharedState.currentQuestionId];
    showCorrectAnswersModal(correctAnswers, questionType, currentQuestion);

    if (questionType === "BLANK" || !currentQuestion) return;

    const correctIndices = Array.isArray(correctAnswers) ? correctAnswers : [correctAnswers];

    optionButtons.forEach((button, buttonIndex) => {
      // Try to get option index from data-cy attribute (format: "option-X")
      const dataCy = button.getAttribute("data-cy");
      let optionIndex = buttonIndex;
      if (dataCy && dataCy.startsWith("option-")) {
        const parsedIndex = parseInt(dataCy.replace("option-", ""), 10);
        if (!isNaN(parsedIndex)) {
          optionIndex = parsedIndex;
        }
      }

      // Also try data-option-id for backwards compatibility
      const optionId =
        button.getAttribute("data-option-id") ||
        button
          .querySelector("[data-option-id]")
          ?.getAttribute("data-option-id");

      // Check if this button matches any correct answer (by index or ID)
      const isCorrect = correctIndices.includes(optionIndex) ||
        (optionId && correctIndices.includes(optionId));

      if (isCorrect) {
        button.classList.add("uets-correct-answer");
        button.style.position = "relative";

        // Only add indicator if not already present
        if (!button.querySelector(".uets-answer-indicator")) {
          const indicator = document.createElement("div");
          indicator.className = "uets-answer-indicator";
          indicator.textContent = "";
          button.appendChild(indicator);
        }
      }
    });
  };

  // === NEW: SHOW CORRECT ANSWERS MODAL ===
  const showCorrectAnswersModal = (
    correctAnswers,
    questionType,
    questionData = null,
  ) => {
    if (!sharedState.uiModificationsEnabled) return;

    let content = "";

    if (questionType === "BLANK") {
      content = `${correctAnswers}`;
    } else if (questionType === "MCQ") {
      const correctIndex = correctAnswers;

      if (!questionData && sharedState.currentQuestionId) {
        questionData = sharedState.questionsPool[sharedState.currentQuestionId];
      }

      if (
        questionData &&
        questionData.structure &&
        questionData.structure.options &&
        questionData.structure.options[correctIndex]
      ) {
        const div = document.createElement("div");
        div.innerHTML = questionData.structure.options[correctIndex].text;
        content = `${div.textContent.trim()}`;
      } else {
        content = `Option ${correctIndex + 1}`;
      }
    } else if (questionType === "MSQ") {
      if (!questionData && sharedState.currentQuestionId) {
        questionData = sharedState.questionsPool[sharedState.currentQuestionId];
      }

      if (
        questionData &&
        questionData.structure &&
        questionData.structure.options
      ) {
        const correctOptions = correctAnswers.map((index) => {
          if (questionData.structure.options[index]) {
            const div = document.createElement("div");
            div.innerHTML = questionData.structure.options[index].text;
            return div.textContent.trim();
          }
          return `Option ${index + 1}`;
        });
        content = `${correctOptions.join("\n")}`;
      } else {
        content = `Options ${correctAnswers.map((i) => i + 1).join(", ")}`;
      }
    } else {
      if (Array.isArray(correctAnswers)) {
        content = `${correctAnswers.join(", ")}`;
      } else {
        content = `${correctAnswers}`;
      }
    }

    showResponsePopup(content, false, "Correct Answers");
  };

  // === CONFIG MANAGEMENT ===
  const saveConfig = () => {
    GM_setValue(CONFIG_STORAGE_KEY, sharedState.config);
  };

  const resetConfig = () => {
    sharedState.config = { ...DEFAULT_CONFIG };
    saveConfig();
  };

  const createConfigGui = () => {
    if (sharedState.uiModificationsEnabled === false) {
      handleToggleUiClick();
    }
    if (sharedState.configGui) return;

    const overlay = document.createElement('div');
    overlay.className = 'uets-config-overlay';
    
    const modal = document.createElement('div');
    modal.className = 'uets-config-modal';

    modal.innerHTML = `
        <div class="uets-config-header">
            <span class="uets-config-title">UETS Settings</span>
            <button class="ugh-popup-close">${ICONS.close}</button>
        </div>
        <div class="uets-config-content">
            <div class="uets-config-section">
                <div class="uets-config-section-title">General</div>
                <div class="uets-config-item">
                    <span class="uets-config-label">Spoof Fullscreen</span>
                    <input type="checkbox" id="enableSpoofFullscreen">
                </div>
                <div class="uets-config-item">
                    <span class="uets-config-label">Site Optimizations</span>
                    <input type="checkbox" id="enableSiteOptimizations">
                </div>
                <div class="uets-config-item">
                    <span class="uets-config-label">Server URL</span>
                    <input type="text" class="uets-config-input" id="serverUrl">
                </div>
            </div>
            
            <div class="uets-config-section">
                <div class="uets-config-section-title">Wayground / Quizizz</div>
                <div class="uets-config-item">
                    <span class="uets-config-label">Hijack Time Taken</span>
                    <input type="checkbox" id="enableTimeTakenEdit">
                </div>
                <div class="uets-config-item">
                    <span class="uets-config-label">Time Min (ms)</span>
                    <input type="number" class="uets-config-input" id="timeTakenMin">
                </div>
                <div class="uets-config-item">
                    <span class="uets-config-label">Time Max (ms)</span>
                    <input type="number" class="uets-config-input" id="timeTakenMax">
                </div>
                <div class="uets-config-item">
                    <span class="uets-config-label">Hijack Timer Points</span>
                    <input type="checkbox" id="enableTimerHijack">
                </div>
                <div class="uets-config-item">
                    <span class="uets-config-label">Timer Bonus</span>
                    <input type="number" class="uets-config-input" id="timerBonusPoints">
                </div>
            </div>

            <div class="uets-config-section">
                <div class="uets-config-section-title">AI & Backend</div>
                <div class="uets-config-item">
                    <span class="uets-config-label">Include Images</span>
                    <input type="checkbox" id="includeImages">
                </div>
                <div class="uets-config-item">
                    <span class="uets-config-label">Gemini API Key</span>
                    <button class="uets-btn uets-btn-secondary" id="setBackendKey">Set Key</button>
                </div>
            </div>
        </div>
        <div class="uets-config-footer">
            <button class="uets-btn uets-btn-secondary" id="uets-reset">Reset</button>
            <button class="uets-btn uets-btn-primary" id="uets-save">Save</button>
        </div>
    `;

    overlay.appendChild(modal);

    // Populate current values
    const populateValues = () => {
      document.getElementById('enableTimeTakenEdit').checked = sharedState.config.enableTimeTakenEdit;
      document.getElementById('timeTakenMin').value = sharedState.config.timeTakenMin;
      document.getElementById('timeTakenMax').value = sharedState.config.timeTakenMax;
      document.getElementById('enableTimerHijack').checked = sharedState.config.enableTimerHijack;
      document.getElementById('timerBonusPoints').value = sharedState.config.timerBonusPoints;
      document.getElementById('enableSpoofFullscreen').checked = sharedState.config.enableSpoofFullscreen;
      document.getElementById('enableSiteOptimizations').checked = sharedState.config.enableSiteOptimizations;
      document.getElementById('serverUrl').value = sharedState.config.serverUrl;
      document.getElementById('includeImages').checked = sharedState.config.includeImages;
    };

    // Event handlers
    modal.querySelector('.ugh-popup-close').onclick = () => closeConfigGui();

    // Set Backend Key handler
    modal.querySelector('#setBackendKey').onclick = () => {
        const newKey = prompt("Enter your Gemini API Key for the Backend:");
        if (newKey !== null) {
            window.dispatchEvent(new CustomEvent('UGH_Save_Key', { detail: { key: newKey } }));
            alert("Key sent to backend!");
        }
    };

    modal.querySelector('#uets-save').onclick = () => {
      // Collect values
      sharedState.config.enableTimeTakenEdit = document.getElementById('enableTimeTakenEdit').checked;
      sharedState.config.timeTakenMin = parseInt(document.getElementById('timeTakenMin').value);
      sharedState.config.timeTakenMax = parseInt(document.getElementById('timeTakenMax').value);
      sharedState.config.enableTimerHijack = document.getElementById('enableTimerHijack').checked;
      sharedState.config.timerBonusPoints = parseInt(document.getElementById('timerBonusPoints').value);
      sharedState.config.enableSpoofFullscreen = document.getElementById('enableSpoofFullscreen').checked;
      sharedState.config.enableSiteOptimizations = document.getElementById('enableSiteOptimizations').checked;
      sharedState.config.serverUrl = document.getElementById('serverUrl').value;
      sharedState.config.includeImages = document.getElementById('includeImages').checked;

      saveConfig();
      closeConfigGui();
    };

    modal.querySelector('#uets-reset').onclick = () => {
      if (confirm('Reset all settings to defaults?')) {
        resetConfig();
        populateValues();
      }
    };

    document.body.appendChild(overlay);
    sharedState.configGui = overlay;
    populateValues();
  };

  const closeConfigGui = () => {
    if (sharedState.configGui) {
      sharedState.configGui.remove();
      sharedState.configGui = null;
    }
  };

  // === SHARED API KEY MANAGEMENT ===
  GM_registerMenuCommand("Set Backend API Key", () => {
    const newKey = prompt("Enter your Gemini API Key for the Backend:");
    if (newKey !== null) {
      window.dispatchEvent(new CustomEvent('UGH_Save_Key', { detail: { key: newKey } }));
      alert("Key sent to backend!");
    }
  });

  // === SHARED IMAGE FETCHING ===
  const fetchImageAsBase64 = (imageUrl) =>
    new Promise((resolve, reject) => {
      GM_log(`[*] Fetching image: ${imageUrl}...`);
      GM_xmlhttpRequest({
        method: "GET",
        url: imageUrl,
        responseType: "blob",
        onload: (response) => {
          if (response.status >= 200 && response.status < 300) {
            const blob = response.response;
            const reader = new FileReader();
            reader.onloadend = () => {
              const dataUrl = reader.result;
              const mimeType = dataUrl.substring(
                dataUrl.indexOf(":") + 1,
                dataUrl.indexOf(";"),
              );
              const base64Data = dataUrl.substring(dataUrl.indexOf(",") + 1);
              GM_log(`[+] Image fetched successfully. MIME type: ${mimeType}`);
              resolve({ base64Data, mimeType });
            };
            reader.onerror = () =>
              reject("FileReader error while processing image.");
            reader.readAsDataURL(blob);
          } else {
            reject(`Failed to fetch image. Status: ${response.status}`);
          }
        },
        onerror: () => reject("Network error while fetching image."),
        ontimeout: () => reject("Image fetch request timed out."),
      });
    });

  // === SHARED GEMINI INTERACTION ===
  const formatQuestionForBackend = (
    question,
    options,
    platform = "quiz",
    endpoint = "/ask"
  ) => {
    let text = `Question: "${question}"\n`;
    if (options && options.length > 0) {
        text += `\nAvailable Options:\n${options.map((opt, i) => `${i + 1}. ${opt}`).join("\n")}`;
    }
    text += `\n\nContext: ${platform}`;
    return text;
  };

  const askBackend = (question, options, imageData, platform = "quiz", endpoint = "/ask") => {
    const text = formatQuestionForBackend(question, options, platform);
    const images = imageData ? [imageData] : [];
    window.dispatchEvent(new CustomEvent('UGH_Request_Analysis', { detail: { text, images, endpoint } }));
  };

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
    showResponsePopup(html, false, "Gemini Assistant");
  };

  const showResponsePopup = (
    contentHTML,
    isLoading = false,
    title = "AI Assistant",
  ) => {
    if (!sharedState.uiModificationsEnabled) {
      if (sharedState.geminiPopup) {
        sharedState.geminiPopup.remove();
        sharedState.geminiPopup = null;
      }
      return;
    }

    let popup = document.getElementById("ugh-gemini-popup");

    // Clear any existing dismiss timeout
    if (sharedState.toastDismissTimeout) {
      clearTimeout(sharedState.toastDismissTimeout);
      sharedState.toastDismissTimeout = null;
    }

    const bodyContent = isLoading 
        ? `<div class="ugh-loading-spinner"></div><div style="text-align:center;margin-top:10px;color:#5f6368">${contentHTML}</div>` 
        : contentHTML;

    if (popup) {
        const body = popup.querySelector('.ugh-popup-body');
        if (body) {
            body.innerHTML = bodyContent;
        }
        const titleEl = popup.querySelector('.ugh-popup-title');
        if (titleEl) titleEl.textContent = title;
        return;
    }

    popup = document.createElement("div");
    popup.id = "ugh-gemini-popup";
    popup.className = "ugh-response-popup";

    popup.innerHTML = `
        <div class="ugh-popup-header">
            <span class="ugh-popup-title">${title}</span>
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

    popup.querySelector('.ugh-popup-close').onclick = () => {
        popup.remove();
        sharedState.geminiPopup = null;
    };

    const input = popup.querySelector('.ugh-popup-input');
    const sendBtn = popup.querySelector('.ugh-popup-send');

    const handleSend = () => {
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        askBackend(text, [], null, "followup");
    };

    sendBtn.onclick = handleSend;
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSend();
    });

    document.body.appendChild(popup);
    sharedState.geminiPopup = popup;
  };

  // === SHARED UI TOGGLE ===
  const updateToggleButtonAppearance = () => {
    if (!sharedState.toggleButton) return;
    if (sharedState.uiModificationsEnabled) {
      sharedState.toggleButton.innerHTML = ICONS.close;
      sharedState.toggleButton.title = "Hide Tool Modifications";
      sharedState.toggleButton.classList.remove("uets-mods-hidden-state");
    } else {
      sharedState.toggleButton.innerHTML = ICONS.add;
      sharedState.toggleButton.title = "Show Tool Modifications";
      sharedState.toggleButton.classList.add("uets-mods-hidden-state");
    }
  };

  const handleToggleUiClick = () => {
    sharedState.uiModificationsEnabled = !sharedState.uiModificationsEnabled;
    GM_setValue(UI_MODS_ENABLED_KEY, sharedState.uiModificationsEnabled);
    updateToggleButtonAppearance();

    const isTestPortal = sharedState.currentDomain.includes("testportal.net") ||
      sharedState.currentDomain.includes("testportal.pl");

    if (!sharedState.uiModificationsEnabled) {
      if (isTestPortal) {
        // On TestPortal: just hide elements with opacity
        document.querySelectorAll(
          ".uets-gemini-button, .uets-main-question-buttons-container, .uets-streak-bonus"
        ).forEach((el) => el.classList.add("uets-testportal-invisible"));

        if (sharedState.geminiPopup) {
          sharedState.geminiPopup.classList.add("uets-testportal-invisible");
        }
      } else {
        // On other sites: remove elements as before
        document.querySelectorAll(
          ".uets-gemini-button, .uets-main-question-buttons-container, .uets-streak-bonus"
        ).forEach((el) => el.remove());

        if (sharedState.geminiPopup) {
          sharedState.geminiPopup.remove();
          sharedState.geminiPopup = null;
        }

        // Remove correct answer highlighting
        document.querySelectorAll("button.option.uets-correct-answer").forEach((button) => {
          button.classList.remove("uets-correct-answer");
          button.style.position = "";
          const indicator = button.querySelector(".uets-answer-indicator");
          if (indicator) {
            indicator.remove();
          }
        });

        document.querySelectorAll(".uets-option-wrapper").forEach((wrapper) => {
          const button = wrapper.querySelector("button.option");
          if (button && wrapper.parentNode) {
            wrapper.parentNode.insertBefore(button, wrapper);
          }
          wrapper.remove();
        });

        sharedState.elementsToCleanup.forEach((el) => {
          if (el && el.parentNode && !el.querySelector("button.option")) {
            el.remove();
          }
        });
        sharedState.elementsToCleanup = [];

        if (sharedState.currentDomain.includes("wayground.com") || sharedState.currentDomain.includes("quizizz.com")) {
          // Revert text edits
          if (sharedState.originalTabLeaveHTML !== null) {
            const ruleDiv = document.querySelector('.test-mode-container');
            if (ruleDiv) {
              ruleDiv.innerHTML = sharedState.originalTabLeaveHTML;
            }
            sharedState.originalTabLeaveHTML = null;
          }
          if (sharedState.originalStartButtonText !== null) {
            const startButton = document.querySelector('.start-game');
            if (startButton) {
              const span = startButton.querySelector('span');
              if (span) {
                span.textContent = sharedState.originalStartButtonText;
              }
            }
            sharedState.originalStartButtonText = null;
          }
        }

        if (sharedState.currentDomain.includes("docs.google.com")) {
          const questionBlocks = document.querySelectorAll(
            'div[role="listitem"] > div[jsmodel]',
          );
          questionBlocks.forEach((block) => {
            delete block.dataset.uetsButtonsAdded;
          });
        }

        if (
          sharedState.currentDomain.includes("testportal.net") ||
          sharedState.currentDomain.includes("testportal.pl")
        ) {
          const questionElements = document.querySelectorAll(".question_essence");
          questionElements.forEach((el) => {
            delete el.dataset.enhancementsAdded;
          });
        }
      }
    } else {
      if (isTestPortal) {
        // On TestPortal: show elements by removing opacity class
        document.querySelectorAll(
          ".uets-gemini-button, .uets-main-question-buttons-container, .uets-streak-bonus"
        ).forEach((el) => el.classList.remove("uets-testportal-invisible"));

        if (sharedState.geminiPopup) {
          sharedState.geminiPopup.classList.remove("uets-testportal-invisible");
        }
      } else {
        setTimeout(() => {
          initializeDomainSpecific();
        }, 100);
      }
    }
  };

  // Add cleanup on navigation (beforeunload event):
  window.addEventListener("beforeunload", () => {
    const isTestPortal = sharedState.currentDomain.includes("testportal.net") ||
      sharedState.currentDomain.includes("testportal.pl");

    if (isTestPortal) {
      // Remove all UETS elements before navigating away from TestPortal
      document.querySelectorAll(
        ".uets-gemini-button, .uets-main-question-buttons-container, .uets-streak-bonus, .ugh-response-popup, .uets-config-overlay"
      ).forEach((el) => el.remove());

      sharedState.elementsToCleanup.forEach((el) => {
        if (el && el.parentNode) {
          el.remove();
        }
      });

      // Remove toggle button on TestPortal before navigation
      if (sharedState.toggleButton) {
        sharedState.toggleButton.remove();
      }

      // Restore original RegExp.prototype.test
      RegExp.prototype.test = sharedState.originalRegExpTest;
    }
  });

  const createToggleButton = () => {
    if (document.getElementById("uets-toggle-ui-button")) return;

    sharedState.toggleButton = document.createElement("button");
    sharedState.toggleButton.id = "uets-toggle-ui-button";
    updateToggleButtonAppearance();

    // Tap/click counter for config GUI
    let lastTapTime = 0;
    let tapCount = 0;
    const TAP_WINDOW_MS = 500;

    const handleTap = (e) => {
      if (e && e.type === 'touchend') {
        e.preventDefault();
      }

      const now = Date.now();
      if (now - lastTapTime < TAP_WINDOW_MS) {
        tapCount += 1;
      } else {
        tapCount = 1;
      }
      lastTapTime = now;

      if (tapCount === 3) {
        createConfigGui();
        tapCount = 0;
      } else if (tapCount === 1) {
        handleToggleUiClick();
      }
    };

    sharedState.toggleButton.addEventListener("click", handleTap);
    sharedState.toggleButton.addEventListener("touchend", handleTap);

    document.body.appendChild(sharedState.toggleButton);
  };

  // === CHECK AND DISPLAY DETECTED ANSWERS ===
  const checkAndDisplayDetectedAnswer = () => {
    if (!sharedState.uiModificationsEnabled) return;

    const currentQuestionId = sharedState.currentQuestionId;
    if (!currentQuestionId) return;

    const detectedAnswer = sharedState.detectedAnswers[currentQuestionId];
    if (!detectedAnswer || !detectedAnswer.formattedAnswer) return;

    GM_log(`[*] Displaying detected answer for question: ${currentQuestionId}`);

    // Format the answer text for display
    let displayText = "";
    const answer = detectedAnswer.formattedAnswer;

    switch (answer.type) {
      case 'single_choice':
        displayText = `${answer.text}`;
        // Also highlight the correct option if UI modifications are enabled
        setTimeout(() => {
          highlightCorrectAnswers([answer.index], detectedAnswer.questionType);
        }, 500);
        break;

      case 'multiple_choice':
        displayText = `${answer.texts.join('\n')}`;
        // Also highlight the correct options if UI modifications are enabled
        setTimeout(() => {
          highlightCorrectAnswers(answer.indices, detectedAnswer.questionType);
        }, 500);
        break;

      case 'text':
        displayText = `${answer.text}`;
        break;

      case 'generic':
        displayText = `${answer.text}`;
        break;

      default:
        displayText = `${detectedAnswer.rawAnswer}`;
    }

    // Show the answer popup
    setTimeout(() => {
      showResponsePopup(displayText, false, "Detected Answer");
    }, 200);
  };


  // === DOMAIN-SPECIFIC MODULES ===

  // === SITE OPTIMIZATIONS ===
  const siteOptimizations = {
    // Dark purple 1280x720 SVG
    darkPurpleSVG: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTI4MCIgaGVpZ2h0PSI3MjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjEyODAiIGhlaWdodD0iNzIwIiBmaWxsPSIjNGYzNzhiIi8+PC9zdmc+',

    blockedPatterns: [
      /^https:\/\/cf\.quizizz\.com\/.*\.mp3$/,
      /^https:\/\/cf\.quizizz\.com\/game\/img\/liveReactions\/.*\.png$/,
      /^https:\/\/cf\.quizizz\.com\/img\/game\/Reopen_Icon\.svg$/,
      /^https:\/\/wayground\.com\/_media\/testpixel\.png$/,
      /^https:\/\/media\.wayground\.com\/resource\/gs\/quizizz-media\/testpixel\.png$/,
      /^https:\/\/quizizz\.com\/_media\/testpixel\.png$/
    ],

    replacedUrls: {
      'https://cf.quizizz.com/themes/v2/classic/joinLobbyWClassic.svg': null,
      'https://cf.quizizz.com/themes/v2/classic/joinClassicWBg.jpg': null
    },

    shouldBlockUrl: (url) => {
      if (!sharedState.config.enableSiteOptimizations) return false;
      return siteOptimizations.blockedPatterns.some(pattern => pattern.test(url));
    },

    shouldReplaceUrl: (url) => {
      if (!sharedState.config.enableSiteOptimizations) return false;
      return url in siteOptimizations.replacedUrls;
    },

    getReplacementUrl: (url) => {
      if (siteOptimizations.shouldReplaceUrl(url)) {
        return siteOptimizations.darkPurpleSVG;
      }
      return url;
    }
  };

  // WAYGROUND MODULE
  const waygroundModule = {
    selectors: {
      questionContainer: 'div[data-testid="question-container-text"]',
      questionText:
        'div[data-testid="question-container-text"] .question-text-color',
      questionImage:
        'div[data-testid="question-container-text"] img, div[class*="question-media-container"] img, img[data-testid="question-container-image"], .question-image',
      optionButtons: "button.option",
      optionText: "div#optionText div.resizeable, .option-text div.resizeable, div.resizeable",
      pageInfo: 'div.pill p, div[class*="question-counter"] p',
      quizContainer: "div[data-quesid]",
    },

    lastPageInfo: "INITIAL_STATE",

    debounce: (func, wait) => {
      let timeout;
      return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
      };
    },

    getCurrentQuestionId: () => {
      const quizContainer = document.querySelector(
        waygroundModule.selectors.quizContainer,
      );
      return quizContainer ? quizContainer.getAttribute("data-quesid") : null;
    },

    extractAndProcess: async () => {
      if (!sharedState.uiModificationsEnabled) return;

      document
        .querySelectorAll(
          ".uets-gemini-button, .uets-main-question-buttons-container, .uets-streak-bonus",
        )
        .forEach((el) => el.remove());

      document.querySelectorAll(".uets-option-wrapper").forEach((wrapper) => {
        const button = wrapper.querySelector("button.option");
        if (button && wrapper.parentNode) {
          wrapper.parentNode.insertBefore(button, wrapper);
        }
        wrapper.remove();
      });

      sharedState.elementsToCleanup = sharedState.elementsToCleanup.filter(
        (el) => {
          return el && el.parentNode;
        },
      );

      const currentQuestionId = waygroundModule.getCurrentQuestionId();
      if (currentQuestionId !== sharedState.currentQuestionId) {
        const previousQuestionId = sharedState.currentQuestionId;
        sharedState.currentQuestionId = currentQuestionId;

        GM_log(`[*] Question changed from ${previousQuestionId} to ${currentQuestionId}`);

        if (currentQuestionId && sharedState.quizData[currentQuestionId]) {
          // Fallback to server request if no local answer detected
          const questionData = sharedState.quizData[currentQuestionId];
          const response = await sendQuestionToServer(
            currentQuestionId,
            questionData.type,
            questionData.structure.options
              ? questionData.structure.options.map((opt) => opt.id)
              : [],
          );

          if (response && response.hasAnswer) {
            highlightCorrectAnswers(
              response.correctAnswers,
              response.questionType,
            );
          }
        }

        // Check for detected answer first when question changes
        if (currentQuestionId && sharedState.detectedAnswers[currentQuestionId]) {
          GM_log(`[*] Found locally detected answer for question: ${currentQuestionId}`);
          checkAndDisplayDetectedAnswer();
        } else {
          // Try to find answer by matching question text if direct ID lookup fails
          let matchedAnswerInfo = null;
          if (currentQuestionId && sharedState.quizData[currentQuestionId]) {
            const currentQuestionData = sharedState.quizData[currentQuestionId];
            const currentQuestionText = currentQuestionData.structure.query.text;

            // Search through detected answers for matching question text
            for (const [storedKey, answerInfo] of Object.entries(sharedState.detectedAnswers)) {
              if (answerInfo.questionText === currentQuestionText) {
                matchedAnswerInfo = answerInfo;
                GM_log(`[*] Found answer by text matching: ${storedKey} -> ${currentQuestionId}`);
                // Store under the current question ID for future reference
                sharedState.detectedAnswers[currentQuestionId] = answerInfo;
                break;
              }
            }
          }

          if (matchedAnswerInfo) {
            checkAndDisplayDetectedAnswer();
          }
        }
      }

      let questionTitle = "";
      let optionTexts = [];
      let questionImageUrl = null;

      const questionImageElement = document.querySelector(
        waygroundModule.selectors.questionImage,
      );
      if (questionImageElement?.src) {
        questionImageUrl = questionImageElement.src.startsWith("/")
          ? window.location.origin + questionImageElement.src
          : questionImageElement.src;
      }

      const questionTitleTextElement = document.querySelector(
        waygroundModule.selectors.questionText,
      );
      const questionTextOuterContainer = document.querySelector(
        waygroundModule.selectors.questionContainer,
      );

      // Extract options first
      const optionButtons = document.querySelectorAll(
        waygroundModule.selectors.optionButtons,
      );
      optionButtons.forEach((button) => {
        const text = button
          .querySelector(waygroundModule.selectors.optionText)
          ?.textContent.trim();
        if (text) optionTexts.push(text);
      });

      if (questionTitleTextElement && questionTextOuterContainer) {
        questionTitle = questionTitleTextElement.textContent.trim();

        if (questionTitle || questionImageUrl || optionTexts.length > 0) {
          addQuestionButtons(
            questionTextOuterContainer,
            questionTitle,
            optionTexts,
            questionImageUrl,
            "quiz",
            true,
            "DDG",
          );
        }
      }
    },

    checkPageInfoAndReprocess: () => {
      const pageInfoElement = document.querySelector(
        waygroundModule.selectors.pageInfo,
      );
      let currentPageInfoText = pageInfoElement
        ? pageInfoElement.textContent.trim()
        : "";

      if (currentPageInfoText !== waygroundModule.lastPageInfo) {
        waygroundModule.lastPageInfo = currentPageInfoText;
        waygroundModule.extractAndProcess();
      }
    },

    enhanceStreakCounter: () => {
      const streakSpan = document.querySelector(
        'span[data-testid="streak-pill-level"]',
      );
      if (
        streakSpan &&
        !streakSpan.nextSibling?.classList?.contains("uets-streak-bonus")
      ) {
        const bonusSpan = document.createElement("span");
        bonusSpan.classList.add("uets-streak-bonus");
        streakSpan.parentNode.insertBefore(bonusSpan, streakSpan.nextSibling);

        const updateBonus = () => {
          const level = parseInt(streakSpan.textContent.trim()) || 0;
          let bonus = 0;
          if (level >= 1 && level <= 3) bonus = 100;
          else if (level >= 4 && level <= 6) bonus = 200;
          else if (level >= 7) bonus = 300;
          bonusSpan.textContent = `+${bonus}`;
        };

        updateBonus();

        // Observe changes to the streak span's text
        const observer = new MutationObserver(updateBonus);
        observer.observe(streakSpan, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      }
    },

    modifyTabLeaveWarning: () => {
      const ruleDiv = document.querySelector('.test-mode-container');
      if (ruleDiv) {
        if (sharedState.originalTabLeaveHTML === null) {
          sharedState.originalTabLeaveHTML = ruleDiv.innerHTML;
        }
        ruleDiv.innerHTML = "<h4 data-v-aceb3d94=\"\" class=\"heading\">Teacher rules bypassed:  </h4><div data-v-aceb3d94=\"\" class=\"test-mode-rules\"><!----><div data-v-aceb3d94=\"\" class=\"rule\">You can leave the Wayground tab during this session. To remove fullscreen warnings enable fullscreen spoofing in settings.</div></div>";
      }
    },

    modifyStartButton: () => {
      const startButton = document.querySelector('.start-game');
      if (startButton) {
        const span = startButton.querySelector('span');
        if (span && span.textContent.includes('Start in fullscreen mode')) {
          if (sharedState.originalStartButtonText === null) {
            sharedState.originalStartButtonText = span.textContent;
          }
          span.textContent = 'Start game';
        }
      }
    },

    initialize: () => {
      waygroundModule.lastPageInfo = "INITIAL_STATE";

      if (sharedState.observer) sharedState.observer.disconnect();

      sharedState.observer = new MutationObserver(
        waygroundModule.debounce(() => {
          if (sharedState.uiModificationsEnabled) {
            waygroundModule.checkPageInfoAndReprocess();
            waygroundModule.enhanceStreakCounter();
            waygroundModule.modifyTabLeaveWarning();
            waygroundModule.modifyStartButton();
          }
        }, 500),
      );

      sharedState.observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      if (sharedState.uiModificationsEnabled) {
        waygroundModule.extractAndProcess();
        waygroundModule.enhanceStreakCounter();
        waygroundModule.modifyTabLeaveWarning();
        waygroundModule.modifyStartButton();
        // Add delay to check for existing streak element
        // NOTE: this may not be enough on shitty connections
        setTimeout(() => waygroundModule.enhanceStreakCounter(), 1000);
      }
    },
  };

  const processQuizData = (data) => {
    GM_log("[*] Trying to get all questions...");
    const questions = data?.data?.room?.questions || data?.room?.questions || data?.quiz?.info?.questions || data?.data?.quiz?.info?.questions;
    if (!questions) {
      GM_log("[!] Could not find questions in data");
      return;
    }
    const questionKeys = Object.keys(questions);

    for (const questionKey of questionKeys) {
      GM_log("[*] ----------------");
      const questionData = questions[questionKey];
      sharedState.quizData[questionKey] = questionData;

      // Store the complete question data in questionsPool
      sharedState.questionsPool[questionKey] = questionData;

      GM_log(`[+] Question ID: ${questionKey}`);
      GM_log(`[+] Question Type: ${questionData.type}`);
      GM_log(`[+] Question Text: ${questionData.structure.query.text}`);
      questionData.structure.query.media?.forEach(media => GM_log(`[+] Media URL: ${media.url} (Type: ${media.type})`));
      const options = questionData.structure?.options || [];
      options.forEach(option => {
        GM_log(`[+] Option: ${option.text} (${option.id})`);
        option.media?.forEach(media => GM_log(`[+] Media URL: ${media.url} (Type: ${media.type})`));
      });

      // Enhanced answer detection and storage
      if (questionData.structure && questionData.structure.answer !== undefined) {
        const correctAnswerData = questionData.structure.answer;
        const hasCorrectAnswer = questionData.structure.settings?.hasCorrectAnswer || (correctAnswerData !== null && correctAnswerData !== undefined);

        if (hasCorrectAnswer) {
          GM_log(`[+] Correct Answer Data: ${JSON.stringify(correctAnswerData)}`);

          // Store the detected answer in our local temp list
          const answerInfo = {
            questionId: questionKey,
            questionType: questionData.type,
            questionText: questionData.structure.query.text,
            rawAnswer: correctAnswerData,
            options: options,
            detectedAt: Date.now(),
            formattedAnswer: null
          };

          // Format the answer based on question type
          if (questionData.type === "MCQ" && options.length > 0) {
            const correctIndex = correctAnswerData;
            if (typeof correctIndex === 'number' && correctIndex >= 0 && correctIndex < options.length) {
              answerInfo.formattedAnswer = {
                type: 'single_choice',
                index: correctIndex,
                text: options[correctIndex].text.replace(/<[^>]*>/g, '').trim()
              };
              GM_log(`[+] MCQ Correct Answer: ${answerInfo.formattedAnswer.text} (index: ${correctIndex})`);
            }
          } else if (questionData.type === "MSQ" && options.length > 0) {
            let correctIndices = Array.isArray(correctAnswerData) ? correctAnswerData : [correctAnswerData];
            correctIndices = correctIndices.filter(idx =>
              typeof idx === 'number' && idx >= 0 && idx < options.length
            );

            if (correctIndices.length > 0) {
              const correctTexts = correctIndices.map(idx => options[idx].text.replace(/<[^>]*>/g, '').trim());
              answerInfo.formattedAnswer = {
                type: 'multiple_choice',
                indices: correctIndices,
                texts: correctTexts
              };
              GM_log(`[+] MSQ Correct Answers: ${correctTexts.join(', ')} (indices: ${correctIndices.join(', ')})`);
            }
          } else if (questionData.type === "BLANK" || questionData.type === "FIB") {
            answerInfo.formattedAnswer = {
              type: 'text',
              text: correctAnswerData
            };
            GM_log(`[+] BLANK/FIB Correct Answer: ${correctAnswerData}`);
          } else {
            answerInfo.formattedAnswer = {
              type: 'generic',
              text: correctAnswerData
            };
            GM_log(`[+] Generic Correct Answer: ${correctAnswerData}`);
          }

          // Store in our local detected answers list with BOTH the current key AND the _id if it exists
          sharedState.detectedAnswers[questionKey] = answerInfo;

          // Also store with the _id as key if it exists and is different
          if (questionData._id && questionData._id !== questionKey) {
            sharedState.detectedAnswers[questionData._id] = answerInfo;
            GM_log(`[+] Answer also stored with _id key: ${questionData._id}`);
          }

          GM_log(`[+] Answer stored locally for question: ${questionKey}`);
        }
      }
    }

    GM_log(`[+] Processed ${questionKeys.length} questions, ${Object.keys(sharedState.detectedAnswers).length} total answer mappings stored`);
  };

  // === REQUEST INTERCEPTION ===
  const originalXMLHttpRequestOpen = XMLHttpRequest.prototype.open;
  const originalXMLHttpRequestSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...args) {
    this._method = method;
    this._url = url;

    // Check if URL should be blocked
    if (siteOptimizations.shouldBlockUrl(url)) {
      this._shouldBlock = true;
      GM_log(`[+] Marked XHR for blocking: ${url}`);
      // Still call original open to prevent errors
      return originalXMLHttpRequestOpen.call(this, method, url, ...args);
    }

    // Check if URL should be replaced
    if (siteOptimizations.shouldReplaceUrl(url)) {
      const newUrl = siteOptimizations.getReplacementUrl(url);
      GM_log(`[+] Replacing XHR URL: ${url} -> dark purple image`);
      return originalXMLHttpRequestOpen.call(this, method, newUrl, ...args);
    }

    const isWaygroundOrQuizizz = url => url.includes("wayground.com") || url.includes("quizizz.com");

    if (typeof url === "string" && url.includes("play-api/createTestGameActivity") && isWaygroundOrQuizizz(url)) {
      this._blocked = true;
      GM_log("[+] Blocked cheating detection request to createTestGameActivity");
    }

    const isQuizJoinUrl = url => (url.includes("play-api") && /soloJoin|rejoinGame|join/.test(url)) || url.includes("_quizserver/main/v2/quiz");

    if (typeof url === "string" && isQuizJoinUrl(url) && isWaygroundOrQuizizz(url)) {
      this.addEventListener("load", function () {
        if (this.status === 200) {
          try { processQuizData(JSON.parse(this.responseText)); }
          catch (e) { GM_log("[!] Failed to parse response:", e); }
        }
      });
    }

    const isProceedUrl = url => url.includes("play-api") && /proceedGame|soloProceed/.test(url);

    if (typeof url === "string" && isProceedUrl(url) && isWaygroundOrQuizizz(url)) {
      this.addEventListener("load", function () {
        if (this.status === 200) {
          try { processProceedGameResponse(JSON.parse(this.responseText)); }
          catch (e) { GM_log("[!] Failed to parse proceedGame response:", e); }
        }
      });
    }

    return originalXMLHttpRequestOpen.call(this, method, url, ...args);
  };

  XMLHttpRequest.prototype.send = function (data) {
    // Handle site optimization blocks
    if (this._shouldBlock) {
      GM_log(`[+] Blocked XHR send: ${this._url}`);
      const xhr = this;
      const mockProps = { readyState: 4, status: 200, statusText: 'OK', response: '', responseText: '', responseType: '', responseXML: null };
      Object.entries(mockProps).forEach(([k, v]) => Object.defineProperty(xhr, k, { get: () => v, configurable: true }));
      setTimeout(() => {
        ['loadstart', 'readystatechange', 'load', 'loadend'].forEach(evt => {
          const handler = xhr[`on${evt}`];
          if (handler) handler.call(xhr, evt === 'readystatechange' ? new Event(evt) : new ProgressEvent(evt));
          xhr.dispatchEvent(evt === 'readystatechange' ? new Event(evt) : new ProgressEvent(evt));
        });
      }, 0);
      return;
    }

    // Block cheating detection requests
    if (this._blocked) {
      GM_log("[+] Cheating detection request blocked - not sending data");
      return;
    }

    // Intercept TestPortal requests and force wb=0
    const isTestPortal = this._url?.includes("testportal.net") || this._url?.includes("testportal.pl");
    if (this._method === "POST" && isTestPortal && this._url.includes("DoTestQuestion.html") && typeof data === "string") {
      try {
        const urlParams = new URLSearchParams(data);
        if (urlParams.has('wb')) {
          urlParams.set('wb', '0');
          GM_log(`[+] Modified TestPortal wb parameter to 0`);
          return originalXMLHttpRequestSend.call(this, urlParams.toString());
        }
      } catch (e) {
        GM_log("[!] Failed to modify TestPortal request:", e);
      }
    }

    // Intercept POST requests to proceedGame and modify timeTaken
    const isProceed = this._url?.includes("play-api") && /proceedGame|soloProceed/.test(this._url);
    const isWaygroundQuizizz = this._url?.includes("wayground.com") || this._url?.includes("quizizz.com");
    if (this._method === "POST" && isProceed && isWaygroundQuizizz && data) {
      try {
        return originalXMLHttpRequestSend.call(this, JSON.stringify(processProceedGameRequest(JSON.parse(data))));
      } catch (e) {
        GM_log("[!] Failed to parse/modify proceedGame request:", e);
      }
    }

    // Intercept requests to reaction-update and resend
    const isReactionUpdate = isWaygroundQuizizz && this._url?.includes("_gameapi/main/public/v1/games/") && this._url?.includes("/reaction-update");
    if (this._method === "POST" && isReactionUpdate && sharedState.config.enableReactionSpam) {
      const result = originalXMLHttpRequestSend.call(this, data);
      for (let i = 1; i <= sharedState.config.reactionSpamCount; i++) {
        setTimeout(() => {
          const xhr = new XMLHttpRequest();
          xhr.open(this._method, this._url);
          xhr.send(data);
        }, sharedState.config.reactionSpamDelay * i);
      }
      return result;
    }

    return originalXMLHttpRequestSend.call(this, data);
  };

  const originalFetch = window.fetch;
  window.fetch = function (url, options) {
    const urlString = typeof url === 'string' ? url : url?.url || url?.href || '';
    const isWaygroundQuizizz = urlString.includes("wayground.com") || urlString.includes("quizizz.com");
    const isTestPortal = urlString.includes("testportal.net") || urlString.includes("testportal.pl");

    // Block site optimization URLs
    if (siteOptimizations.shouldBlockUrl(urlString)) {
      GM_log(`[+] Blocked fetch: ${urlString}`);
      return Promise.resolve(new Response(null, { status: 200, statusText: 'OK', headers: new Headers({ 'Content-Type': 'application/octet-stream' }) }));
    }

    // Replace theme URLs
    if (siteOptimizations.shouldReplaceUrl(urlString)) {
      GM_log(`[+] Replacing fetch URL: ${urlString} -> dark purple image`);
      return originalFetch.call(this, siteOptimizations.getReplacementUrl(urlString), options);
    }

    // Block cheating detection requests
    if (urlString.includes("play-api/createTestGameActivity") && isWaygroundQuizizz) {
      GM_log("[+] Blocked cheating detection request to createTestGameActivity");
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200, statusText: "OK" }));
    }

    // Intercept TestPortal requests via fetch and force wb=0
    if (isTestPortal && urlString.includes("DoTestQuestion.html") && options?.method === "POST" && typeof options.body === "string") {
      try {
        const urlParams = new URLSearchParams(options.body);
        if (urlParams.has('wb')) {
          urlParams.set('wb', '0');
          GM_log(`[+] Modified TestPortal wb parameter to 0`);
          return originalFetch.call(this, url, { ...options, body: urlParams.toString() });
        }
      } catch (e) {
        GM_log("[!] Failed to modify TestPortal fetch request:", e);
      }
    }

    // Intercept POST requests to proceedGame via fetch
    const isProceedUrl = urlString.includes("play-api") && /proceedGame|soloProceed/.test(urlString);
    if (isProceedUrl && isWaygroundQuizizz && options?.method === "POST" && options.body) {
      try {
        return originalFetch.call(this, url, { ...options, body: JSON.stringify(processProceedGameRequest(JSON.parse(options.body))) });
      } catch (e) {
        GM_log("[!] Failed to parse/modify proceedGame fetch request:", e);
      }
    }

    // Intercept requests to reaction-update via fetch
    const isReactionUpdate = isWaygroundQuizizz && urlString.includes("_gameapi/main/public/v1/games/") && urlString.includes("/reaction-update");
    if (isReactionUpdate && options?.method === "POST" && options.body && sharedState.config.enableReactionSpam) {
      const result = originalFetch.call(this, url, options);
      for (let i = 1; i <= sharedState.config.reactionSpamCount; i++) {
        setTimeout(() => originalFetch.call(this, url, options), sharedState.config.reactionSpamDelay * i);
      }
      return result;
    }

    const isQuizJoinUrl = (urlString.includes("play-api") && /soloJoin|rejoinGame|join/.test(urlString)) || urlString.includes("_quizserver/main/v2/quiz");
    if (isQuizJoinUrl && isWaygroundQuizizz) {
      return originalFetch.call(this, url, options).then(response => {
        if (response.ok) return response.clone().json().then(data => { processQuizData(data); return response; }).catch(() => response);
        return response;
      });
    }

    if (isProceedUrl && isWaygroundQuizizz) {
      return originalFetch.call(this, url, options).then(response => {
        if (response.ok) return response.clone().json().then(data => { processProceedGameResponse(data); return response; }).catch(() => response);
        return response;
      });
    }

    return originalFetch.call(this, url, options);
  };

  // === DOMAIN DETECTION AND INITIALIZATION ===
  const initializeDomainSpecific = () => {
    const hostname = window.location.hostname;

    if (
      hostname.includes("quizizz.com") ||
      hostname.includes("wayground.com")
    ) {
      GM_log("[*] Initializing Wayground module...");
      if (sharedState.config.enableSpoofFullscreen) {
        spoofFullscreenAndFocus();
      }
      waygroundModule.initialize();
    }
  };

  // === MAIN INITIALIZATION ===
  const main = () => {
    // Load config on startup
    const savedConfig = GM_getValue(CONFIG_STORAGE_KEY, null);
    if (savedConfig) {
      sharedState.config = { ...DEFAULT_CONFIG, ...savedConfig };
    }

    // Listen for Backend Responses
    window.addEventListener('UGH_Response_Success', (e) => {
        parseAndDisplay(e.detail.text);
    });
    window.addEventListener('UGH_Response_Progress', (e) => {
        parseAndDisplay(e.detail.text);
    });
    window.addEventListener('UGH_Response_Loading', () => {
        showResponsePopup("Analyzing...", true, "AI Assistant");
    });
    window.addEventListener('UGH_Response_Error', (e) => {
        showResponsePopup(e.detail.message, false, "Error");
    });

    createToggleButton();
    initializeDomainSpecific();
    GM_log(`[+] UETS loaded on ${sharedState.currentDomain}`);
    GM_log(`[+] Made by Nyx, modified by Tullysaurus (with Gemini's help)`);

    // Check for first run and show welcome popup
    if (!GM_getValue(sharedState.firstRunKey, false)) {
      GM_setValue(sharedState.firstRunKey, true);
      setTimeout(() => showWelcomePopup(), 1000); // Delay to ensure page is loaded
    }
  };

  if (document.body) {
    main();
  } else {
    window.addEventListener("DOMContentLoaded", main);
  }
})();
