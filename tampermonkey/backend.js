// ==UserScript==
// @name         UGH Backend (Core & API)
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Handles API requests, Key storage, and Prompt generation for Universal Gemini Helper.
// @author       Tullysaurus
// @license      GPL-3.0
// @match        *://*/*
// @grant        GM_log
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function () {
    "use strict";

    // === CONSTANTS ===
    const API_KEY_STORAGE = "UGH_GEMINI_API_KEY";
    const CONFIG = {
        temperature: 0.2,
        maxOutputTokens: 2048,
        topP: 0.95,
        topK: 64
    };

    // === STATE ===
    let currentRequest = null;
    let currentAnalysisId = 0;

    // === UTILITIES ===
    const getApiKey = () => GM_getValue(API_KEY_STORAGE, "");
    const setApiKey = (key) => GM_setValue(API_KEY_STORAGE, key.trim());

    const fetchImageAsBase64 = (imageUrl) => {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: imageUrl,
                responseType: "blob",
                onload: (response) => {
                    if (response.status >= 200 && response.status < 300) {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                            const dataUrl = reader.result;
                            const mimeType = dataUrl.substring(dataUrl.indexOf(":") + 1, dataUrl.indexOf(";"));
                            const base64Data = dataUrl.substring(dataUrl.indexOf(",") + 1);
                            resolve({ mimeType, base64Data });
                        };
                        reader.readAsDataURL(response.response);
                    } else {
                        reject(`Status: ${response.status}`);
                    }
                },
                onerror: () => reject("Network error"),
                ontimeout: () => reject("Timeout")
            });
        });
    };

    // === PROMPT GENERATOR ===
    const buildGeminiPrompt = (text, hasImages = false) => {
        const systemPrompt = `You are an expert educational AI assistant. Your task is to analyze the following question or text and identify the correct answer.

STRICT FORMATTING RULES:

1. **Correct Answer**: Provide the direct answer clearly.

2. **Explanation**: Provide concise reasoning below it.

3. **Rich Text**:

   - Use **bold** for key terms and the correct option.

   - Use *italics* for emphasis or definitions.

   - Use lists (lines starting with -) for steps or multiple points.

   - Use \`code\` formatting for technical terms or numbers if relevant.

4. **No Chattyness**: Do NOT ask if the user needs more help. Do NOT ask follow-up questions. End the response immediately after the explanation.

5. **No Images**: Do not include images in your output.

6. **Proper Answers**: Make sure that the output answers are always IDENTICAL to the original choices, include any spelling mistakes or weird punctuation.

7. **Lists**: If there are multiple correct answers, you are to list them, separated by " || " (spaces included).

No matter what, you are to always follow these formatting rules in your responses.

OUTPUT STRUCTURE:

Correct Answer: [Answer1 || Answer2 || ...]



Explanation: [Rich Text Explanation]`;

        let prompt = `${systemPrompt}\n\n${text}\n`;

        if (hasImages) {
            prompt += `\n(Note: attached images are part of the question context)\n`;
        }
        
        return prompt;
    };

    // === API HANDLER ===
    const performAnalysis = async (text, imageInput, endpoint = '/ask') => {
        const analysisId = ++currentAnalysisId;

        if (currentRequest) {
            currentRequest.abort();
            currentRequest = null;
        }

        const apiKey = getApiKey();
        if (!apiKey) {
            dispatchToFrontend('UGH_Response_Error', { message: "API Key missing. Please check settings." });
            return;
        }

        // Notify Frontend we are working
        dispatchToFrontend('UGH_Response_Loading', {});

        const promptText = buildGeminiPrompt(text, !!imageInput);
        const parts = [{ text: promptText }];

        if (imageInput) {
            const imagesToProcess = Array.isArray(imageInput) ? imageInput : [imageInput];
            for (const img of imagesToProcess) {
                if (analysisId !== currentAnalysisId) return;
                try {
                    let imageData = null;
                    if (typeof img === 'object' && img.base64Data && img.mimeType) {
                        imageData = img;
                    } else if (typeof img === 'string' && img.startsWith('http')) {
                        imageData = await fetchImageAsBase64(img);
                    }
                    if (imageData) {
                        parts.push({
                            inline_data: { mime_type: imageData.mimeType, data: imageData.base64Data }
                        });
                    }
                } catch (err) { console.error("UGH Backend: Image error", err); }
            }
        }

        if (analysisId !== currentAnalysisId) return;

        const apiUrl = `https://ugh.tully-dev.com${endpoint}?key=${apiKey}`;
        const payload = {
            contents: [{ parts: parts }],
            generationConfig: CONFIG
        };

        let streamProcessed = false;

        currentRequest = GM_xmlhttpRequest({
            method: "POST",
            url: apiUrl,
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify(payload),
            responseType: 'stream',
            onreadystatechange: async (response) => {
                if (analysisId !== currentAnalysisId) return;
                if (response.readyState >= 2 && !streamProcessed) {
                    if (!response.response) return;
                    streamProcessed = true;

                    if (response.status < 200 || response.status >= 300) {
                        dispatchToFrontend('UGH_Response_Error', { message: `API Error: ${response.status}` });
                        return;
                    }

                    const stream = response.response;
                    const reader = stream.getReader();
                    const decoder = new TextDecoder();
                    let accumulatedText = "";

                    try {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;

                            const chunk = decoder.decode(value, { stream: true });
                            accumulatedText += chunk;

                            if (accumulatedText.startsWith("[ERROR:")) {
                                dispatchToFrontend('UGH_Response_Error', { message: accumulatedText });
                                return;
                            }

                            dispatchToFrontend('UGH_Response_Progress', { text: accumulatedText });
                        }
                        dispatchToFrontend('UGH_Response_Success', { text: accumulatedText });
                    } catch (err) {
                        console.error("Stream reading error", err);
                        dispatchToFrontend('UGH_Response_Error', { message: "Stream reading error" });
                    }
                }
            },
            onerror: () => dispatchToFrontend('UGH_Response_Error', { message: "Network request failed." }),
            ontimeout: () => dispatchToFrontend('UGH_Response_Error', { message: "Request timed out." })
        });
    };

    // === COMMUNICATION ===
    const dispatchToFrontend = (eventName, detail) => {
        window.dispatchEvent(new CustomEvent(eventName, { detail }));
    };

    // === EVENT LISTENERS (Listening to Frontend) ===
    window.addEventListener('UGH_Request_Analysis', (e) => {
        const { text, images, endpoint } = e.detail;
        performAnalysis(text, images, endpoint);
    });

    window.addEventListener('UGH_Save_Key', (e) => {
        setApiKey(e.detail.key);
        // Optional: Confirm save back to frontend?
    });

    window.addEventListener('UGH_Get_Key_Request', () => {
        dispatchToFrontend('UGH_Send_Key', { key: getApiKey() });
    });

    // Helper for Copy Prompt Logic (Frontend asks Backend to build it)
    window.addEventListener('UGH_Request_Build_Prompt', (e) => {
        const { text, hasImages } = e.detail;
        const prompt = buildGeminiPrompt(text, hasImages);
        dispatchToFrontend('UGH_Return_Built_Prompt', { prompt });
    });

})();