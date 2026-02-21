import os
import base64
import asyncio
import hashlib
import json
from datetime import datetime, timedelta, UTC

from dotenv import load_dotenv
from fastapi import HTTPException
from openai import AsyncOpenAI  # Use OpenAI's client for OpenRouter

from database import get_db, SessionLocal
from schema import APIKeyHash

load_dotenv()

# --- Configuration ---
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
# Default model: google/gemini-2.0-flash-001 or similar via OpenRouter
DEFAULT_MODEL = "stepfun/step-3.5-flash:free" 

if not OPENROUTER_API_KEY:
    raise HTTPException(status_code=500, detail="Server Error: Missing OpenRouter API Key.")

# Initialize OpenRouter Client
client = AsyncOpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=OPENROUTER_API_KEY,
    default_headers={
        "HTTP-Referer": "https://tully.sh", # Optional, for OpenRouter rankings
        "X-Title": "Educational AI Assistant",   # Optional
    }
)

SYSTEM_PROMPT = """
You are an expert educational AI assistant. Your task is to analyze the preceeding question or text and identify the correct answer.
STRICT FORMATTING RULES:
1. **Correct Answer**: Provide the direct answer clearly.
2. **Explanation**: Provide concise reasoning below it.
3. **Rich Text**:
   - Use **bold** for key terms and the correct option.
   - Use *italics* for emphasis or definitions.
   - Use lists (lines starting with -) for steps or multiple points.
   - Use `code` formatting for technical terms or numbers if relevant.
4. **No Chattyness**: Do NOT ask if the user needs more help. Do NOT ask follow-up questions. End the response immediately after the explanation.
5. **No Images**: Do not include images or references to images in your output.
6. **Proper Answers**: Make sure that the output answers are always IDENTICAL to the original choices, include any spelling mistakes or weird punctuation.
7. **Lists**: If there are multiple correct answers, you are to list them, separated by " || " (spaces included).
No matter what, you are to always follow these formatting rules in your responses. Do not use any previous context to generate your responses, treat each prompt as its own chat.
OUTPUT STRUCTURE:
Correct Answer: [Answer1 || Answer2 || ...]

Explanation: [Rich Text Explanation]
"""

# --- Database Helpers ---

def get_key_in_db(key, db):
    hashed_key = hashlib.sha256(key.encode()).hexdigest()
    return db.query(APIKeyHash).filter(APIKeyHash.key_hash == hashed_key).first()

def get_history(key, db):
    data = get_key_in_db(key, db)
    if data and data.chat_metadata:
        try:
            return json.loads(data.chat_metadata)
        except:
            return []
    return []

def save_history(key, db, messages):
    data = get_key_in_db(key, db)
    if data:
        # We only keep the last few messages to stay within context limits
        data.chat_metadata = json.dumps(messages[-10:]) 
        db.commit()

# --- Core Logic ---

async def generate_response_stream(prompt_text: str, key, db, files: list[bytes], model: str = DEFAULT_MODEL):

    # Ensure history is always a list of OBJECTS, not strings
    raw_history = get_history(key, db)
    history = []
    for msg in raw_history:
        if isinstance(msg, dict) and "role" in msg and "content" in msg:
            history.append(msg)
        elif isinstance(msg, str):
            # If it's a legacy string, wrap it in a user object
            history.append({"role": "user", "content": msg})

    # Prepare the current message content
    # If there are no files, use a simple string (most reliable)
    # If there are files, use the multi-part list format
    if not files:
        current_content = prompt_text
    else:
        current_content = [{"type": "text", "text": prompt_text}]
        for image_bytes in files:
            base64_image = base64.b64encode(image_bytes).decode('utf-8')
            current_content.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/jpeg;base64,{base64_image}"
                }
            })

    # Build the final message list
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT}
    ]
    messages.extend(history)
    messages.append({"role": "user", "content": current_content})

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=messages,
            stream=True
        )

        full_response_text = ""
        async for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                delta = chunk.choices[0].delta.content
                full_response_text += delta
                yield delta

        # Update history with clean objects
        history.append({"role": "user", "content": prompt_text})
        history.append({"role": "assistant", "content": full_response_text})
        save_history(key, db, history)

    except Exception as e:
        print(f"[!] OpenRouter Error: {e}")
        yield f"Error: {str(e)}"

async def process_gemini_request_stream(contents, key, model=DEFAULT_MODEL):
    """
    Adapter to convert your incoming 'contents' structure to the generator.
    """
    prompt_text = ""
    files = []
    
    for content in contents:
        for part in content.parts:
            if hasattr(part, 'text') and part.text:
                prompt_text += part.text + "\n"
            
            if hasattr(part, 'inline_data') and part.inline_data:
                try:
                    # Assuming part.inline_data.data is the base64 string or bytes
                    image_data = base64.b64decode(part.inline_data.data)
                    files.append(image_data)
                except Exception as e:
                    print(f"Failed to decode base64 image: {e}")

    async for chunk in generate_response_stream(prompt_text, key, SessionLocal(), files, model):
        yield chunk