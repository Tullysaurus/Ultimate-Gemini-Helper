import os
import base64
import asyncio
import hashlib
import tempfile
from gemini_webapi import GeminiClient
from gemini_webapi.constants import Model

from dotenv import load_dotenv
from fastapi import HTTPException
from database import get_db, SessionLocal
from schema import SavedQuestion, APIKeyHash
import json

from datetime import datetime, timedelta, UTC
load_dotenv()

prompt = """
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


default_model = Model.G_3_0_FLASH
# vercel_default_model = "openai:gpt-3.5-turbo"

SECURE_1PSID = os.getenv("SECURE_1PSID")
SECURE_1PSIDTS = os.getenv("SECURE_1PSIDTS")

if not SECURE_1PSID or not SECURE_1PSIDTS:
    raise HTTPException(status_code=500, detail="Server Error: Missing Gemini Cookies in environment variables.")

quiz_gem = None
initialized = False
client = GeminiClient(SECURE_1PSID, SECURE_1PSIDTS, proxy=None)

async def ensure_initialized():
    global quiz_gem
    global initialized
    if not initialized:
        await client.init(timeout=30, auto_close=True, close_delay=60 * 60, auto_refresh=True, refresh_interval=60 * 15)
        await client.fetch_gems(include_hidden=False, language="en")
        gems = client.gems
        # Try to get the specific gem, fallback to default if not found
        quiz_gem = gems.get("34bf4ad11421")
        if not quiz_gem:
            print("Quiz Gem ID not found, using default model.")
            quiz_gem = None
        else:
            print(f"Gemini Client Initialized. Gem: {quiz_gem}")

        initialized = True


def get_key_in_db(key, db):
    hashed_key = hashlib.sha256(key.encode()).hexdigest()
    data = db.query(APIKeyHash).filter(APIKeyHash.key_hash == hashed_key).first()

    return data



async def delete_chat(key, db):
    data = get_key_in_db(key, db)

    if data:
        await client.delete_chat(data.chat_metadata[0])
        data.chat_metadata = ""
        db.commit()
        return True
    
    return False

def get_chat(key, db):

    data = get_key_in_db(key, db)

    if data and data.chat_metadata:
        return json.loads(data.chat_metadata)
    
    return None

def create_chat(key, db, model=default_model):

    chat = client.start_chat(model=model, gem=quiz_gem)

    data = get_key_in_db(key, db)

    if data:
        data.chat_metadata = json.dumps(chat.metadata)
        db.commit()

        return chat.metadata
    return None

def init_chat(key, db):

    metadata = get_chat(key, db)
    if metadata != None:
        return metadata
    
    metadata = create_chat(key, db)
    return metadata

def save_metadata(key, db, metadata):
    data = get_key_in_db(key, db)
    
    if data:
        data.chat_metadata = json.dumps(metadata)
        db.commit()


# def run_vercel_prompt(prompt_text):
#     messages = [
#         {"role": "system", "content": prompt},
#         {"role": "user", "content": prompt_text}
#     ]
#     params = {
#         "maxLength": 1000
#     }

#     for chunk in vercel_client.chat(vercel_default_model, messages, params):
#         yield chunk


async def generate_response_stream(prompt_text: str, key, db, files: list[bytes], model : str=default_model):
    await ensure_initialized()


    # if files and len(files) == 0:
    #     print("[+] Skipping using gemini, using vercel instead")
    #     for chunk in run_vercel_prompt(prompt_text):
    #         yield chunk

    #     return

    data = get_key_in_db(key, db)
    if data:
        if datetime.utcnow() - data.lastUsed > timedelta(minutes=5):
            print("[+] Chat expired due to inactivity. Starting new chat.")
            await delete_chat(key, db)

    metadata = init_chat(key, db)

    chat = client.start_chat(metadata=metadata, model=model, gem=quiz_gem)
    
    temp_files = []
    if files and len(files) > 0:
        if len(files) > 10: files = files[0:9]
        for file in files:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as temp_file:
                temp_file.write(file)
                temp_file_path = temp_file.name
                temp_files.append(temp_file_path)



    try:

        async for chunk in chat.send_message_stream(prompt_text, files=temp_files):
            yield chunk.text_delta
        save_metadata(key, db, chat.metadata)

    except Exception as e:

        print(f"[+] Warning: Image generation failed ({e}). Falling back to text-only.")
        # async for chunk in run_vercel_prompt(prompt_text):
        #     yield chunk

    finally:

        # Delete the files after use
        for temp_file in temp_files:
            if os.path.exists(temp_file):
                os.remove(temp_file)

        

async def process_gemini_request_stream(contents, key, model=default_model):

    prompt_text = ""
    image_data = None
    files = []
    
    for content in contents:
        for part in content.parts:
            # Handle Text
            if part.text:
                prompt_text += part.text + "\n"
            
            # Handle Image (Base64)
            if part.inline_data:
                try:
                    image_data = base64.b64decode(part.inline_data.data)
                    files.append(image_data)
                except Exception:
                    print("Failed to decode base64 image")

    async for chunk in generate_response_stream(prompt_text, key, SessionLocal(), files, model):
        # print(chunk, end="")
        yield chunk
