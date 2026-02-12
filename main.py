import os
import uvicorn
import base64
from fastapi import FastAPI, HTTPException, Query, Request
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from gemini_webapi import GeminiClient
from dotenv import load_dotenv


load_dotenv()
# --- Configuration ---
# 1. Real Gemini Cookies (Back-end)
SECURE_1PSID = os.getenv("SECURE_1PSID")
SECURE_1PSIDTS = os.getenv("SECURE_1PSIDTS")


# 2. Your Custom API Key (Front-end)
# Matches the `apiKey` variable in your JS
VALID_API_KEY = os.getenv("VALID_API_KEY")

app = FastAPI(title="Gemini API Mirror")

# --- Pydantic Models (Matching your JS Payload) ---

class InlineData(BaseModel):
    mime_type: str
    data: str # This is the base64 string

class Part(BaseModel):
    text: Optional[str] = None
    inline_data: Optional[InlineData] = None

class Content(BaseModel):
    parts: List[Part]

# We define these even if we don't use them, so the API accepts the request
class ThinkingConfig(BaseModel):
    thinkingBudget: Optional[int] = None

class GenerationConfig(BaseModel):
    temperature: Optional[float] = None
    topP: Optional[float] = None
    topK: Optional[float] = None
    maxOutputTokens: Optional[int] = None
    thinkingConfig: Optional[ThinkingConfig] = None

class SafetySetting(BaseModel):
    category: str
    threshold: str

class GenerateContentRequest(BaseModel):
    contents: List[Content]
    generationConfig: Optional[GenerationConfig] = None
    safetySettings: Optional[List[SafetySetting]] = None

# --- Dependency: Gemini Client ---

async def get_gemini_client():
    if not SECURE_1PSID or not SECURE_1PSIDTS:
        raise HTTPException(status_code=500, detail="Server Error: Missing Gemini Cookies in environment variables.")
    
    client = GeminiClient(SECURE_1PSID, SECURE_1PSIDTS)
    # Initialize client (adjust timeout/auto_close as needed)
    await client.init(timeout=30, auto_close=False, auto_refresh=True)
    return client

# --- Endpoints ---

@app.post("/ai/{model}")
async def generate_content(
    model: str, 
    request: GenerateContentRequest, 
    key: str = Query(..., description="The API Key") # catches ?key=... from JS
):
    # 1. Validate API Key
    if key != VALID_API_KEY:
        raise HTTPException(status_code=400, detail="Invalid API Key")

    client = await get_gemini_client()

    try:
        prompt_text = ""
        image_data = None
        
        # 2. Parse the complex JS payload
        for content in request.contents:
            for part in content.parts:
                # Handle Text
                if part.text:
                    prompt_text += part.text + "\n"
                
                # Handle Image (Base64)
                if part.inline_data:
                    # The library usually expects bytes or file path. 
                    # We decod the base64 string to raw bytes.
                    try:
                        image_data = base64.b64decode(part.inline_data.data)
                    except Exception:
                        print("Failed to decode base64 image")

        # 3. Call the Unofficial WebAPI
        # Note: The web interface ignores temperature/safety settings usually, 
        # so we only pass prompt and image.
        if image_data:
            # Pass image if available. 
            # Note: Verify specific syntax for your installed version of gemini-webapi
            response = await client.generate_content(prompt_text, image=image_data)
        else:
            response = await client.generate_content(prompt_text)

        # 4. Format Response to EXACTLY match what your JS expects
        # JS expects: result.candidates[0].content.parts[0].text
        formatted_response = {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "text": response.text
                            }
                        ],
                        "role": "model"
                    },
                    "finishReason": "STOP",
                    "index": 0,
                    "safetyRatings": [] # Empty to satisfy schema if needed
                }
            ]
        }

        return formatted_response

    except Exception as e:
        print(f"Error: {e}")
        # Return a structure that your JS error handler catches (result.error.message)
        return {
            "error": {
                "code": 500,
                "message": str(e),
                "status": "INTERNAL_ERROR"
            }
        }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)