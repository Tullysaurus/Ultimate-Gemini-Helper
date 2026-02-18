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

default_model = Model.G_3_0_FLASH

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
        await client.init(timeout=30, auto_close=True, close_delay=300, auto_refresh=True, refresh_interval=300)
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


async def generate_response_stream(prompt_text: str, key, db, files: list[bytes], model : str=default_model):
    await ensure_initialized()

    data = get_key_in_db(key, db)
    if data:
        if datetime.utcnow() - data.lastUsed > timedelta(minutes=30):
            print("Chat expired due to inactivity. Starting new chat.")
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

        print(f"Warning: Image generation failed ({e}). Falling back to text-only.")
        async for chunk in chat.send_message_stream(prompt_text):
            yield chunk.text_delta
        save_metadata(key, db, chat.metadata)

    finally:

        # Delete the files after use
        for temp_file in temp_files:
            if os.path.exists(temp_file):
                os.remove(temp_file)

        

async def process_gemini_request_stream(contents, key, model=default_model):
    await ensure_initialized()
    
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
        print(chunk, end="")
        yield chunk
