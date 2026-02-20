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
    const HOSTNAME_STORAGE = "UGH_GEMINI_HOSTNAME"
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
    const getHostname = () => GM_getValue(HOSTNAME_STORAGE, "https://ugh.tully.sh");
    const setHostname = (hostname) => GM_setValue(HOSTNAME_STORAGE, hostname.trim());

    /**
     * Creates options for GM_xmlhttpRequest with common parameters.
     * @param {string} method - HTTP method (e.g., "POST", "GET").
     * @param {string} endpoint - API endpoint (e.g., "/ai", "/ask", "/answers").
     * @param {object} [payload=null] - Request body for POST requests.
     * @param {object} [queryParams={}] - Additional query parameters.
     * @param {boolean} [isStreaming=false] - Whether the response is expected to be a stream.
     * @returns {object} Options object for GM_xmlhttpRequest.
     */
    const createGmHttpRequestOptions = (method, endpoint, payload = null, queryParams = {}, isStreaming = false) => {
        const apiKey = getApiKey();
        if (!apiKey) {
            throw new Error("API Key missing. Please check settings.");
        }

        const url = new URL(`${getHostname()}${endpoint}`);
        url.searchParams.append('key', apiKey);
        for (const key in queryParams) {
            url.searchParams.append(key, queryParams[key]);
        }

        const options = {
            method: method,
            url: url.toString(),
            headers: { "Content-Type": "application/json" },
            onerror: (response) => {
                GM_log(`UGH Backend: Network error for ${url.toString()}:`, response);
                dispatchToFrontend('UGH_Response_Error', { message: `Network error: ${response.statusText || response.status}` });
            },
            ontimeout: () => {
                GM_log(`UGH Backend: Request timed out for ${url.toString()}`);
                dispatchToFrontend('UGH_Response_Error', { message: "Request timed out." });
            }
        };

        if (payload) options.data = JSON.stringify(payload);
        if (isStreaming) options.responseType = 'stream';
        return options;
    };

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
        let prompt = `${text}`;

        if (hasImages) {
            prompt += `\n(Note: attached images are part of the question context)\n`;
        }

        return prompt;
    };

    /**
     * Makes a non-streaming API request and returns a Promise resolving with the parsed JSON response.
     * Dispatches UGH_Response_Error on failure.
     * @param {string} method - HTTP method (e.g., "POST", "GET").
     * @param {string} endpoint - API endpoint (e.g., "/answers").
     * @param {object} [payload=null] - Request body.
     * @param {object} [queryParams={}] - Query parameters.
     * @returns {Promise<object>} A promise that resolves with the JSON response.
     */
    const makeJsonApiRequest = async (method, endpoint, payload = null, queryParams = {}) => {
        try {
            const options = createGmHttpRequestOptions(method, endpoint, payload, queryParams, false);
            const response = await new Promise((resolve, reject) => {
                options.onload = resolve;
                options.onerror = reject;
                options.ontimeout = reject;
                GM_xmlhttpRequest(options);
            });

            if (response.status < 200 || response.status >= 300) {
                throw new Error(`API Error: ${response.status} - ${response.responseText}`);
            }
            return JSON.parse(response.responseText);
        } catch (error) {
            GM_log(`UGH Backend: JSON API request failed for ${endpoint}:`, error);
            dispatchToFrontend('UGH_Response_Error', { message: error.message || "JSON API request failed." });
            throw error; // Re-throw to allow caller to handle if needed
        }
    };

    /**
     * Handles streaming API requests for AI analysis.
     * @param {string} text - The main text for the prompt.
     * @param {Array<object>} imageInput - Array of image data (base64Data, mimeType) or URLs.
     * @param {string} endpoint - The API endpoint to use (e.g., "/ai", "/ask").
     */
    const performAnalysis = async (text, imageInput, endpoint = '/ask') => {
        const analysisId = ++currentAnalysisId; // Increment for new request

        // Abort any previous ongoing request
        if (currentRequest) {
            currentRequest.abort();
            currentRequest = null;
        }

        // Notify Frontend we are starting
        dispatchToFrontend('UGH_Response_Loading', {});

        const promptText = buildGeminiPrompt(text, !!imageInput);
        const parts = [{ text: promptText }];

        if (imageInput && imageInput.length > 0) {
            const imagesToProcess = Array.isArray(imageInput) ? imageInput : [imageInput];
            for (const img of imagesToProcess) {
                if (analysisId !== currentAnalysisId) return; // Abort if a new request started during image processing
                try {
                    let imageData = null;
                    if (typeof img === 'object' && img.base64Data && img.mimeType) {
                        imageData = img; // Already in correct format
                    } else if (typeof img === 'string' && img.startsWith('http')) {
                        imageData = await fetchImageAsBase64(img); // Fetch and convert URL to base64
                    }
                    if (imageData) {
                        parts.push({
                            inline_data: { mime_type: imageData.mimeType, data: imageData.base64Data }
                        });
                    }
                } catch (err) {
                    GM_log("UGH Backend: Image processing error", err);
                    // Optionally dispatch an error to frontend about image processing failure
                }
            }
        }

        if (analysisId !== currentAnalysisId) return; // Final check before making the API call

        const payload = {
            contents: [{ parts: parts }],
            generationConfig: CONFIG
        };

        try {
            const options = createGmHttpRequestOptions("POST", endpoint, payload, {}, true); // isStreaming = true
            let streamProcessed = false;
            let accumulatedText = "";

            currentRequest = GM_xmlhttpRequest({
                ...options,
                onreadystatechange: async (response) => {
                    if (analysisId !== currentAnalysisId) return; // Abort if a new request started

                    if (response.readyState >= 2 && !streamProcessed) {
                        // Check for HTTP errors early
                        if (response.status < 200 || response.status >= 300) {
                            dispatchToFrontend('UGH_Response_Error', { message: `API Error: ${response.status}` });
                            currentRequest = null;
                            return;
                        }

                        if (!response.response) return; // Wait for the stream to be available
                        streamProcessed = true;

                        const stream = response.response; // This is assumed to be a ReadableStream
                        const reader = stream.getReader();
                        const decoder = new TextDecoder();

                        try {
                            while (true) {
                                const { done, value } = await reader.read();
                                if (done) break;

                                const chunk = decoder.decode(value, { stream: true });
                                accumulatedText += chunk;

                                if (accumulatedText.startsWith("[ERROR:")) {
                                    dispatchToFrontend('UGH_Response_Error', { message: accumulatedText });
                                    currentRequest = null;
                                    return;
                                }

                                dispatchToFrontend('UGH_Response_Progress', { text: accumulatedText });
                            }
                            dispatchToFrontend('UGH_Response_Success', { text: accumulatedText });
                        } catch (err) {
                            GM_log("UGH Backend: Stream reading error", err);
                            dispatchToFrontend('UGH_Response_Error', { message: "Stream reading error." });
                        } finally {
                            currentRequest = null; // Clear current request after completion or error
                        }
                    }
                },
                // onerror and ontimeout are already handled by createGmHttpRequestOptions
            });
        } catch (error) {
            GM_log("UGH Backend: Error initiating analysis request:", error);
            dispatchToFrontend('UGH_Response_Error', { message: error.message || "Failed to initiate analysis." });
            currentRequest = null;
        }
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

    window.addEventListener('UGH_Save_Hostname', (e) => {
        setHostname(e.detail.hostname);
    });

    // New: Event listener for getting answers (if frontend ever needs to trigger this directly)
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