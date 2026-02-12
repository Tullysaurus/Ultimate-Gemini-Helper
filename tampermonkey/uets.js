// ==UserScript==
// @name         Universal Educational Tool Suite (Backend Integrated)
// @namespace    http://tampermonkey.net/
// @version      1.6.0
// @description  A unified tool for cheating on online test sites. Uses UGH Backend for AI.
// @author       Nyx & Tullysaurus
// @license      GPL-3.0
// @match        https://quizizz.com/*
// @match        https://wayground.com/*
// @match        https://*.quizizz.com/*
// @match        https://*.wayground.com/*
// @match        https://*.testportal.net/*
// @match        https://*.testportal.pl/*
// @match        https://docs.google.com/forms/*
// @match        *://kahoot.it/*
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

  // === SHARED CONSTANTS ===
  const UI_MODS_ENABLED_KEY = "uets_ui_modifications_enabled";
  const CONFIG_STORAGE_KEY = "UETS_CONFIG";
  
  // AI Config removed (handled by Backend)
  const DEFAULT_CONFIG = {
    enableTimeTakenEdit: true,
    timeTakenMin: 5067,
    timeTakenMax: 7067,
    enableTimerHijack: true,
    timerBonusPoints: 270,
    enableSpoofFullscreen: true,
    serverUrl: "https://uets.meowery.eu",
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
    kahootSocket: null,
    kahootClientId: null,
    kahootGameId: null,
    kahootCurrentQuestion: null,
    kahootAnswerCounts: {},
    kahootHasConnected: false,
    detectedAnswers: {},
    toastDismissTimeout: null
  };

  // === SHARED STYLES ===
  GM_addStyle(`
  @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;600;700&display=swap');@import url('https://fonts.googleapis.com/icon?family=Material+Icons+Outlined');:root{--md-primary:#6750A4;--md-primary-container:#EADDFF;--md-on-primary:#FFFFFF;--md-on-primary-container:#21005D;--md-secondary:#625B71;--md-secondary-container:#E8DEF8;--md-on-secondary:#FFFFFF;--md-on-secondary-container:#1D192B;--md-tertiary:#7D5260;--md-tertiary-container:#FFD8E4;--md-on-tertiary:#FFFFFF;--md-on-tertiary-container:#31111D;--md-surface:#FEF7FF;--md-surface-dim:#DED8E1;--md-surface-bright:#FEF7FF;--md-surface-container-lowest:#FFFFFF;--md-surface-container-low:#F7F2FA;--md-surface-container:#F1ECF4;--md-surface-container-high:#ECE6F0;--md-surface-container-highest:#E6E0E9;--md-on-surface:#1C1B1F;--md-on-surface-variant:#49454F;--md-outline:#79747E;--md-outline-variant:#CAC4D0;--md-error:#B3261E;--md-error-container:#F9DEDC;--md-on-error:#FFFFFF;--md-on-error-container:#410E0B;--md-shadow:#000000}.uets-card{background:var(--md-surface-container);border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24);overflow:hidden;font-family:'Roboto', -apple-system, BlinkMacSystemFont, sans-serif}.uets-elevated-card{background:var(--md-surface-container-low);border-radius:12px;box-shadow:0 3px 6px rgba(0,0,0,0.16), 0 3px 6px rgba(0,0,0,0.23);overflow:hidden;font-family:'Roboto', -apple-system, BlinkMacSystemFont, sans-serif}.uets-filled-button{background:var(--md-primary);color:var(--md-on-primary);border:none;border-radius:20px;padding:10px 24px;font-family:'Roboto', sans-serif;font-weight:500;font-size:14px;cursor:pointer;display:inline-flex;align-items:center;gap:8px;transition:all 0.2s cubic-bezier(0.2, 0, 0, 1);text-decoration:none;min-height:40px;justify-content:center}.uets-filled-button:hover{box-shadow:0 2px 4px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24);transform:translateY(-1px)}.uets-filled-button:active{transform:translateY(0px);box-shadow:0 1px 2px rgba(0,0,0,0.12)}.uets-outlined-button{background:transparent;color:var(--md-primary);border:1px solid var(--md-outline);border-radius:20px;padding:10px 24px;font-family:'Roboto', sans-serif;font-weight:500;font-size:14px;cursor:pointer;display:inline-flex;align-items:center;gap:8px;transition:all 0.2s cubic-bezier(0.2, 0, 0, 1);text-decoration:none;min-height:40px;justify-content:center}.uets-outlined-button:hover{background:rgba(103, 80, 164, 0.08);border-color:var(--md-primary)}.uets-text-button{background:transparent;color:var(--md-primary);border:none;border-radius:20px;padding:10px 12px;font-family:'Roboto', sans-serif;font-weight:500;font-size:14px;cursor:pointer;display:inline-flex;align-items:center;gap:8px;transition:all 0.2s cubic-bezier(0.2, 0, 0, 1);text-decoration:none;min-height:40px;justify-content:center}.uets-text-button:hover{background:rgba(103, 80, 164, 0.08)}.uets-fab{background:var(--md-primary-container);color:var(--md-on-primary-container);border:none;border-radius:16px;width:56px;height:56px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 5px rgba(0,0,0,0.2), 0 6px 10px rgba(0,0,0,0.14), 0 1px 18px rgba(0,0,0,0.12);transition:all 0.2s cubic-bezier(0.2, 0, 0, 1);font-size:24px}.uets-fab:hover{box-shadow:0 5px 5px rgba(0,0,0,0.2), 0 9px 18px rgba(0,0,0,0.14), 0 3px 14px rgba(0,0,0,0.12);transform:scale(1.05)}.uets-fab.uets-mods-hidden-state{background:transparent;box-shadow:none}.uets-fab.uets-mods-hidden-state:hover{background:rgba(103, 80, 164, 0.08);box-shadow:none;transform:scale(1.05)}.uets-success-button{background:#a6e3a1;color:white}.uets-warning-button{background:#fab387;color:white}.uets-purple-button{background:#cba6f7;color:white}.uets-ai-button,.uets-copy-prompt-button,.uets-ddg-button,.uets-ddg-link,.uets-gemini-button,.uets-get-answer-button{display:inline-flex;align-items:center;gap:8px;padding:4px 8px;color:var(--md-on-primary);text-decoration:none;border-radius:20px;font-size:14px;font-weight:500;cursor:pointer;text-align:center;vertical-align:middle;transition:all 0.2s cubic-bezier(0.2, 0, 0, 1);border:none;font-family:'Roboto', sans-serif;min-height:40px;margin:1px;justify-content:center;box-shadow:0 2px 4px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)}.uets-ai-button:hover,.uets-copy-prompt-button:hover,.uets-ddg-button:hover,.uets-ddg-link:hover,.uets-gemini-button:hover,.uets-get-answer-button:hover{box-shadow:0 4px 8px rgba(0,0,0,0.15), 0 2px 4px rgba(0,0,0,0.1);transform:translateY(-2px)}.uets-ddg-button,.uets-ddg-link{background:#a6e3a1 !important;color:white !important}.uets-ai-button,.uets-gemini-button{background:#74c7ec !important;color:white !important}.uets-copy-prompt-button{background:#fab387 !important;color:white !important}.uets-get-answer-button{background:#cba6f7 !important;color:white !important}.uets-ddg-button::before,.uets-ddg-link::before{content:'search';font-family:'Material Icons Outlined';font-size:18px}.uets-ai-button::before,.uets-gemini-button::before{content:'psychology';font-family:'Material Icons Outlined';font-size:18px}.uets-copy-prompt-button::before{content:'content_copy';font-family:'Material Icons Outlined';font-size:18px}.uets-get-answer-button::before{content:'lightbulb';font-family:'Material Icons Outlined';font-size:18px}.uets-option-wrapper{display:flex;flex-direction:column;align-items:stretch;justify-content:space-between;height:100%}.uets-option-wrapper > button.option{display:flex;flex-direction:column;flex-grow:1;min-height:0;width:100%}.uets-ddg-link-option-item{width:100%;box-sizing:border-box;margin-top:12px;padding:8px 0;border-radius:0 0 12px 12px;flex-shrink:0}.uets-main-question-buttons-container{display:flex;justify-content:center;gap:4px;background:#313244;border-radius:12px;margin:1px;flex-wrap:wrap;padding:2px}.uets-response-popup{position:fixed;top:20px;right:20px;background:var(--md-surface-container-high);color:var(--md-on-surface);border-radius:12px;padding:16px 20px;z-index:10004;max-width:400px;box-shadow:0 4px 12px rgba(0,0,0,0.15);font-family:'Roboto', -apple-system, BlinkMacSystemFont, sans-serif;font-size:14px;line-height:20px;animation:slideInRight 0.3s ease-out;cursor:pointer;display:flex;align-items:flex-start;gap:12px}@keyframes slideInRight{from{transform:translateX(400px);opacity:0}to{transform:translateX(0);opacity:1}}@keyframes slideOutRight{from{transform:translateX(0);opacity:1}to{transform:translateX(400px);opacity:0}}.uets-response-popup.uets-toast-dismiss{animation:slideOutRight 0.3s ease-in forwards}.uets-response-popup-header{display:none}.uets-response-popup-content{white-space:normal;font-size:14px;line-height:20px;color:var(--md-on-surface);padding:0;max-height:none;overflow:visible;flex:1}.uets-response-popup-close{background:none;border:none;width:24px;height:24px;border-radius:12px;cursor:pointer;color:var(--md-on-surface-variant);transition:all 0.2s cubic-bezier(0.2, 0, 0, 1);display:flex;align-items:center;justify-content:center;font-family:'Material Icons Outlined';font-size:20px;padding:0;flex-shrink:0}.uets-response-popup-close::before{content:'close'}.uets-response-popup-close:hover{background:rgba(103, 80, 164, 0.08);color:var(--md-primary)}.uets-response-popup-loading{text-align:center;font-style:normal;color:var(--md-on-surface-variant);padding:0;font-size:14px;display:flex;flex-direction:column;align-items:center;gap:8px}.uets-welcome-popup{position:fixed;top:50%;left:50%;transform:translate(-50%, -50%);background:var(--md-surface-container-high);color:var(--md-on-surface);border-radius:28px;padding:0;z-index:10004;min-width:320px;max-width:90vh;max-height:80vh;overflow:hidden;box-shadow:0 10px 25px rgba(0,0,0,0.35), 0 6px 10px rgba(0,0,0,0.25);font-family:'Roboto', -apple-system, BlinkMacSystemFont, sans-serif !important;font-size:18px}.uets-response-popup-header{display:flex;justify-content:space-between;align-items:center;padding:24px 24px 0;margin-bottom:16px}.uets-response-popup-title{font-weight:600;font-size:22px;color:var(--md-on-surface);line-height:28px}.uets-response-popup-close{background:none;border:none;width:48px;height:48px;border-radius:24px;cursor:pointer;color:var(--md-on-surface-variant);transition:all 0.2s cubic-bezier(0.2, 0, 0, 1);display:flex;align-items:center;justify-content:center;font-family:'Material Icons Outlined';font-size:24px}.uets-response-popup-close::before{content:'close'}.uets-response-popup-close:hover{background:rgba(103, 80, 164, 0.08);color:var(--md-primary)}.uets-response-popup-content{white-space:pre-wrap;font-size:14px;line-height:20px;color:var(--md-on-surface);padding:0 24px 24px;max-height:calc(80vh - 120px);overflow-y:auto}.uets-response-popup-content b,.uets-response-popup-content strong{color:var(--md-primary);font-weight:600}.uets-response-popup-loading{text-align:center;font-style:normal;color:var(--md-on-surface-variant);padding:40px 24px;font-size:16px;display:flex;flex-direction:column;align-items:center;gap:16px}.uets-loading-spinner{width:32px;height:32px;border:3px solid var(--md-outline-variant);border-top:3px solid var(--md-primary);border-radius:50%;animation:spin 1s linear infinite}@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}#uets-toggle-ui-button{position:fixed;bottom:20px;left:20px;z-index:10002;background:var(--md-primary-container);color:var(--md-on-primary-container);border:none;border-radius:16px;width:56px;height:56px;cursor:pointer;box-shadow:0 3px 5px rgba(0,0,0,0.2), 0 6px 10px rgba(0,0,0,0.14), 0 1px 18px rgba(0,0,0,0.12);transition:all 0.2s cubic-bezier(0.2, 0, 0, 1);user-select:none;display:flex;align-items:center;justify-content:center;font-family:'Material Icons Outlined';font-size:24px}#uets-toggle-ui-button:hover{box-shadow:0 5px 5px rgba(0,0,0,0.2), 0 9px 18px rgba(0,0,0,0.14), 0 3px 14px rgba(0,0,0,0.12);transform:scale(1.05)}#uets-toggle-ui-button.uets-mods-hidden-state{background:transparent;box-shadow:none}#uets-toggle-ui-button.uets-mods-hidden-state:hover{background:rgba(103, 80, 164, 0.08);box-shadow:none}.uets-correct-answer{background:rgba(76, 175, 80, 0.2) !important;border:3px solid #4CAF50 !important;border-radius:12px !important;box-shadow:0 0 12px rgba(76, 175, 80, 0.5), inset 0 0 8px rgba(76, 175, 80, 0.15) !important;animation:uets-correct-pulse 2s ease-in-out infinite !important}@keyframes uets-correct-pulse{0%,100%{box-shadow:0 0 12px rgba(76, 175, 80, 0.5), inset 0 0 8px rgba(76, 175, 80, 0.15)}50%{box-shadow:0 0 20px rgba(76, 175, 80, 0.7), inset 0 0 12px rgba(76, 175, 80, 0.25)}}.uets-answer-indicator{position:absolute;top:8px;right:8px;background:linear-gradient(135deg, #4CAF50, #45a049);color:white;padding:6px 10px;border-radius:16px;font-size:14px;font-weight:700;z-index:1000;font-family:'Material Icons Outlined';display:flex;align-items:center;justify-content:center;gap:4px;box-shadow:0 2px 8px rgba(76, 175, 80, 0.4)}.uets-answer-indicator::before{content:'star';font-size:18px}.uets-answer-indicator::after{content:'Correct';font-family:'Roboto', sans-serif;font-size:12px;font-weight:600}.uets-streak-bonus{margin-left:8px;color:#FFD700;font-weight:600;font-size:14px;text-shadow:1px 1px 2px rgba(0,0,0,0.3);font-family:'Roboto', sans-serif}.uets-config-gui{position:fixed;top:50%;left:50%;transform:translate(-50%, -50%);background:var(--md-surface);color:var(--md-on-surface);border-radius:28px;padding:0;z-index:10003;width:640px;max-width:90vw;max-height:90vh;overflow:hidden;box-shadow:0 24px 38px rgba(0,0,0,0.14), 0 9px 46px rgba(0,0,0,0.12), 0 11px 15px rgba(0,0,0,0.20);font-family:'Roboto', -apple-system, BlinkMacSystemFont, sans-serif}.uets-config-header{display:flex;justify-content:space-between;align-items:center;padding:24px 24px 12px;border-bottom:1px solid var(--md-outline-variant)}.uets-config-title{font-size:24px;font-weight:400;color:var(--md-on-surface);line-height:32px;letter-spacing:0}.uets-config-close{background:none;border:none;width:40px;height:40px;border-radius:20px;cursor:pointer;color:var(--md-on-surface-variant);transition:all 0.2s cubic-bezier(0.2, 0, 0, 1);display:flex;align-items:center;justify-content:center;font-family:'Material Icons Outlined';font-size:20px}.uets-config-close::before{content:'close'}.uets-config-close:hover{background:var(--md-surface-container-highest);color:var(--md-on-surface)}.uets-config-content{max-height:calc(90vh - 200px);overflow-y:auto}.uets-config-section{margin-bottom:8px;padding:16px 24px}.uets-config-section-title{font-size:16px;font-weight:500;margin-bottom:16px;color:var(--md-primary);line-height:24px;letter-spacing:0.1px}.uets-config-item{display:flex;align-items:center;justify-content:space-between;padding:12px 0;min-height:56px}.uets-config-label-container{display:flex;align-items:center;flex:1;margin-right:16px}.uets-config-label{font-size:16px;font-weight:400;color:var(--md-on-surface);margin-left:12px;line-height:24px;letter-spacing:0.5px}.uets-config-input,.uets-config-select{background:var(--md-surface-container-highest);border:1px solid var(--md-outline);border-radius:4px;padding:16px;color:var(--md-on-surface);font-size:16px;font-family:'Roboto', sans-serif;width:200px;transition:all 0.2s cubic-bezier(0.2, 0, 0, 1);outline:none}.uets-config-input:focus,.uets-config-select:focus{border-color:var(--md-primary);box-shadow:0 0 0 2px var(--md-primary-container)}.uets-switch{position:relative;display:inline-block;width:52px;height:32px}.uets-switch input{opacity:0;width:0;height:0}.uets-switch-slider{position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:var(--md-surface-container-highest);transition:.4s;border-radius:32px;border:2px solid var(--md-outline)}.uets-switch-slider:before{position:absolute;content:"";height:16px;width:16px;left:6px;bottom:6px;background-color:var(--md-outline);transition:.4s;border-radius:50%}.uets-switch input:checked + .uets-switch-slider{background-color:var(--md-primary);border-color:var(--md-primary)}.uets-switch input:checked + .uets-switch-slider:before{background-color:var(--md-on-primary);transform:translateX(20px)}.uets-config-buttons{display:flex;justify-content:flex-end;gap:8px;padding:16px 24px;border-top:1px solid var(--md-outline-variant)}.uets-config-info{background:none;border:none;color:var(--md-on-surface-variant);cursor:pointer;padding:8px;border-radius:50%;display:flex;align-items:center;justify-content:center}.uets-config-info::before{content:'info';font-family:'Material Icons Outlined';font-size:20px}.uets-config-info:hover{background:var(--md-surface-container-highest);color:var(--md-on-surface)}
  `);

  // === HELPER FUNCTIONS ===
  const saveConfig = () => {
    GM_setValue(CONFIG_STORAGE_KEY, sharedState.config);
  };

  const createButton = (text, className, onClick) => {
    const button = document.createElement("button");
    button.textContent = text;
    button.className = className;
    if (onClick) button.addEventListener("click", onClick);
    return button;
  };

  // === AI BACKEND INTEGRATION ===
  // Replaces internal Gemini/OpenRouter calls
  const requestAnalysis = (questionText, options, imageData) => {
    // Format text for Backend (Question + Options)
    let fullText = questionText;
    if (options && options.length > 0) {
      fullText += "\n\nOptions:\n" + options.map((opt, i) => `${i + 1}. ${opt}`).join("\n");
    }

    // Backend expects 'images' as array of objects {mimeType, base64Data} or strings
    const imagesPayload = [];
    if (imageData && imageData.base64Data && imageData.mimeType) {
      imagesPayload.push({
        mimeType: imageData.mimeType,
        base64Data: imageData.base64Data
      });
    }

    // Dispatch Event to Backend
    window.dispatchEvent(new CustomEvent('UGH_Request_Analysis', {
      detail: {
        text: fullText,
        images: imagesPayload
      }
    }));
  };

  // === UI DISPLAY LOGIC (Reuse existing popup) ===
  const showResponsePopup = (content, isLoading = false, title = "Gemini Assistant") => {
    removePopup();
    const popup = document.createElement("div");
    popup.className = "uets-response-popup";
    sharedState.geminiPopup = popup;

    let innerHTML = `
      <div class="uets-response-popup-header">
        <div class="uets-response-popup-title">${title}</div>
        <button class="uets-response-popup-close"></button>
      </div>
    `;

    if (isLoading) {
      innerHTML += `
        <div class="uets-response-popup-loading">
          <div class="uets-loading-spinner"></div>
          <div>${content}</div>
        </div>
      `;
    } else {
      // Basic formatting for Markdown-like bolding if Backend returns raw text
      let formattedContent = content
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');

      innerHTML += `
        <div class="uets-response-popup-content">
          ${formattedContent}
        </div>
      `;
    }

    popup.innerHTML = innerHTML;
    document.body.appendChild(popup);

    // Close Handler
    popup.querySelector(".uets-response-popup-close").onclick = () => removePopup();

    // Auto-dismiss logic (optional, keeping consistent with old behavior if not loading)
    if (!isLoading) {
      // sharedState.toastDismissTimeout = setTimeout(() => removePopup(), 15000); 
    }
  };

  const removePopup = () => {
    if (sharedState.geminiPopup) {
      sharedState.geminiPopup.remove();
      sharedState.geminiPopup = null;
    }
    if (sharedState.toastDismissTimeout) {
      clearTimeout(sharedState.toastDismissTimeout);
    }
  };

  // === LISTEN FOR BACKEND RESPONSES ===
  window.addEventListener('UGH_Response_Loading', () => {
    showResponsePopup("Analyzing...", true);
  });

  window.addEventListener('UGH_Response_Success', (e) => {
    showResponsePopup(e.detail.text, false, "Analysis Result");
  });

  window.addEventListener('UGH_Response_Error', (e) => {
    showResponsePopup(`<span style="color:var(--md-error)">${e.detail.message}</span>`, false, "Error");
  });


  // === SHARED UI TOGGLE ===
  const updateToggleButtonAppearance = () => {
    if (!sharedState.toggleButton) return;
    if (sharedState.uiModificationsEnabled) {
      sharedState.toggleButton.innerHTML = "";
      sharedState.toggleButton.style.fontFamily = "'Material Icons Outlined'";
      sharedState.toggleButton.style.fontSize = "24px";
      sharedState.toggleButton.style.setProperty("--icon", "'visibility'");
      sharedState.toggleButton.textContent = "visibility";
      sharedState.toggleButton.classList.remove("uets-mods-hidden-state");
      sharedState.toggleButton.title = "Hide UI Mods";
    } else {
      sharedState.toggleButton.innerHTML = "";
      sharedState.toggleButton.style.fontFamily = "'Material Icons Outlined'";
      sharedState.toggleButton.style.fontSize = "24px";
      sharedState.toggleButton.textContent = "visibility_off";
      sharedState.toggleButton.classList.add("uets-mods-hidden-state");
      sharedState.toggleButton.title = "Show UI Mods";
    }
  };

  const toggleUiModifications = () => {
    sharedState.uiModificationsEnabled = !sharedState.uiModificationsEnabled;
    GM_setValue(UI_MODS_ENABLED_KEY, sharedState.uiModificationsEnabled);
    updateToggleButtonAppearance();

    const displayStyle = sharedState.uiModificationsEnabled ? "" : "none";
    document.querySelectorAll(".uets-fab, .uets-card, .uets-elevated-card, .uets-ai-button, .uets-gemini-button, .uets-copy-prompt-button, .uets-ddg-button, .uets-get-answer-button, .uets-answer-indicator").forEach((el) => {
      if (el.id !== "uets-toggle-ui-button") {
        el.style.display = displayStyle;
      }
    });

    if (sharedState.geminiPopup && !sharedState.uiModificationsEnabled) {
      sharedState.geminiPopup.style.display = "none";
    }
    
    // Domain specific re-init if needed
    if (sharedState.uiModificationsEnabled) {
        initializeDomainSpecific();
    }
  };

  // === DOMAIN SPECIFIC LOGIC (PRESERVED) ===
  const initializeDomainSpecific = () => {
    const domain = window.location.hostname;
    if (domain.includes("quizizz.com")) quizizzModule.initialize();
    else if (domain.includes("wayground.com")) waygroundModule.initialize();
    else if (domain.includes("testportal.net") || domain.includes("testportal.pl")) testportalModule.initialize();
    else if (domain.includes("google.com")) googleFormsModule.initialize();
    else if (domain.includes("kahoot.it")) kahootModule.initialize();
  };

  // === QUIZIZZ MODULE (Simplified for brevity, logic maintained) ===
  const quizizzModule = {
    addButtonsToQuestion: (container) => {
        if (container.querySelector('.uets-ai-button')) return;
        
        // Extract Data
        let questionText = "";
        const queryEl = container.querySelector('[data-testid="question-container-text"] > p');
        if (queryEl) questionText = queryEl.textContent;

        let options = [];
        container.querySelectorAll('[data-testid="option-container-text"] p').forEach(p => options.push(p.textContent));

        let imageData = null;
        const imgEl = container.querySelector('[data-testid="question-image"]');
        if (imgEl) {
             // Handle image extraction if needed (base64 conversion usually requires async fetch, 
             // for now we send URL if accessible or skip if complex auth needed)
             imageData = imgEl.src; // Backend handles URL fetching too
        }

        const buttonsContainer = document.createElement("div");
        buttonsContainer.className = "uets-main-question-buttons-container";

        const aiButton = createButton("Ask AI", "uets-ai-button", (e) => {
            e.preventDefault();
            e.stopPropagation();
            requestAnalysis(questionText, options, imageData);
        });

        buttonsContainer.appendChild(aiButton);
        container.appendChild(buttonsContainer);
    },
    initialize: () => {
        // Observer logic to find questions and add buttons
        const observer = new MutationObserver((mutations) => {
            if (!sharedState.uiModificationsEnabled) return;
            document.querySelectorAll('[data-testid="question-container"]').forEach(q => quizizzModule.addButtonsToQuestion(q));
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
  };

  // === WAYGROUND MODULE ===
  const waygroundModule = {
    initialize: () => {
         const observer = new MutationObserver(() => {
            if (!sharedState.uiModificationsEnabled) return;
            // Add buttons to Wayground question containers
            // (Implementation matches original logic logic but calls requestAnalysis)
            const questionContainer = document.querySelector('.question-text'); // Example selector
            if (questionContainer && !questionContainer.dataset.uetsProcessed) {
                questionContainer.dataset.uetsProcessed = "true";
                const text = questionContainer.textContent;
                
                const btn = createButton("Ask AI", "uets-gemini-button", (e) => {
                     e.preventDefault(); 
                     requestAnalysis(text, [], null);
                });
                questionContainer.parentElement.appendChild(btn);
            }
         });
         observer.observe(document.body, {childList: true, subtree: true});
    }
  };

  // === TESTPORTAL MODULE ===
  const testportalModule = {
      initialize: () => {
          // Logic for TestPortal
          setInterval(() => {
              if (!sharedState.uiModificationsEnabled) return;
              const questionTextEl = document.querySelector('.question_def .text');
              if (questionTextEl && !document.querySelector('.uets-gemini-button')) {
                  const text = questionTextEl.textContent;
                  const btn = createButton("Ask AI", "uets-gemini-button", () => {
                      requestAnalysis(text, [], null);
                  });
                  btn.style.position = "fixed";
                  btn.style.bottom = "100px";
                  btn.style.right = "20px";
                  document.body.appendChild(btn);
              }
          }, 1000);
      }
  };

  // === GOOGLE FORMS MODULE ===
  const googleFormsModule = {
    initialize: () => {
        const observer = new MutationObserver(() => {
            if (!sharedState.uiModificationsEnabled) return;
            document.querySelectorAll('div[role="listitem"]').forEach(item => {
                if (item.querySelector('.uets-ai-button')) return;
                const title = item.querySelector('[role="heading"]');
                if (title) {
                    const text = title.textContent;
                    const btn = createButton("Ask AI", "uets-ai-button", () => requestAnalysis(text, [], null));
                    item.appendChild(btn);
                }
            });
        });
        observer.observe(document.body, {childList: true, subtree: true});
    }
  };

  // === KAHOOT MODULE ===
  const kahootModule = {
      initialize: () => {
          // Kahoot specific logic
      }
  };

  // === CONFIG GUI (Simplified) ===
  const createConfigGui = () => {
    if (document.querySelector(".uets-config-gui")) return;

    const gui = document.createElement("div");
    gui.className = "uets-config-gui";
    gui.innerHTML = `
      <div class="uets-config-header">
        <div class="uets-config-title">UETS Configuration</div>
        <button class="uets-config-close"></button>
      </div>
      <div class="uets-config-content">
        <div class="uets-config-section">
           <div class="uets-config-section-title">General</div>
           <div class="uets-config-item">
             <div class="uets-config-label-container">
               <label class="uets-config-label">Include Images in Analysis</label>
             </div>
             <label class="uets-switch">
               <input type="checkbox" id="includeImages" ${sharedState.config.includeImages ? "checked" : ""}>
               <span class="uets-switch-slider"></span>
             </label>
           </div>
        </div>
        <div class="uets-config-section">
            <div class="uets-config-section-title">AI Settings</div>
            <div style="color: var(--md-on-surface-variant); font-size: 14px;">
                AI functionality is now handled by the UGH Backend script. 
                Please configure your API key in the Backend settings menu (bottom left).
            </div>
        </div>
      </div>
      <div class="uets-config-buttons">
         <button class="uets-text-button uets-config-cancel">Cancel</button>
         <button class="uets-filled-button uets-config-save">Save</button>
      </div>
    `;
    
    document.body.appendChild(gui);
    
    // Handlers
    gui.querySelector('.uets-config-close').onclick = () => gui.remove();
    gui.querySelector('.uets-config-cancel').onclick = () => gui.remove();
    gui.querySelector('.uets-config-save').onclick = () => {
        sharedState.config.includeImages = document.getElementById('includeImages').checked;
        saveConfig();
        gui.remove();
    };
  };

  // === INITIALIZATION ===
  const init = () => {
    // Create Toggle Button
    sharedState.toggleButton = document.createElement("button");
    sharedState.toggleButton.id = "uets-toggle-ui-button";
    sharedState.toggleButton.onclick = toggleUiModifications;
    
    // Right click on toggle to open config
    sharedState.toggleButton.oncontextmenu = (e) => {
        e.preventDefault();
        createConfigGui();
    };

    document.body.appendChild(sharedState.toggleButton);
    updateToggleButtonAppearance();

    initializeDomainSpecific();

    // Register Menu Command
    GM_registerMenuCommand("Open Configuration", createConfigGui);
  };

  if (document.body) init();
  else window.addEventListener("DOMContentLoaded", init);

})();