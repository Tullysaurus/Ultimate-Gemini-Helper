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
        let prompt = `You are an expert educational AI assistant.\nYour task is to analyze the following question or text and identify the correct answer.\n\nContent to analyze:\n"${text}"\n`;

        if (hasImages) {
            prompt += `\n(Note: attached images are part of the question context)\n`;
        }

        prompt += `
STRICT FORMATTING RULES:
1. **Correct Answer**: Provide the direct answer clearly.
2. **Explanation**: Provide a detailed reasoning below it.
3. **Rich Text**:
   - Use **bold** for key terms and the correct option.
   - Use *italics* for emphasis or definitions.
   - Use lists (lines starting with -) for steps or multiple points.
   - Use \`code\` formatting for technical terms or numbers if relevant.
4. **No Chattyness**: Do NOT ask if the user needs more help. Do NOT ask follow-up questions. End the response immediately after the explanation.

OUTPUT STRUCTURE:
Correct Answer: [Answer]

Explanation: [Rich Text Explanation]`;
        return prompt;
    };

    // === API HANDLER ===
    const performAnalysis = async (text, imageInput, endpoint = '/ask') => {
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

        const apiUrl = `https://ugh.tully-dev.com${endpoint}?key=${apiKey}`;
        const payload = {
            contents: [{ parts: parts }],
            generationConfig: CONFIG
        };

        GM_xmlhttpRequest({
            method: "POST",
            url: apiUrl,
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify(payload),
            onload: (response) => {
                try {
                    const result = JSON.parse(response.responseText);
                    const aiText = result.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (aiText) {
                        dispatchToFrontend('UGH_Response_Success', { text: aiText });
                    } else if (result.error) {
                        dispatchToFrontend('UGH_Response_Error', { message: `API Error: ${result.error.message}` });
                    } else {
                        dispatchToFrontend('UGH_Response_Error', { message: "Unknown API response." });
                    }
                } catch (e) {
                    dispatchToFrontend('UGH_Response_Error', { message: "Failed to parse JSON response." });
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