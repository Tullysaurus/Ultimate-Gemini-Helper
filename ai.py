import os
import base64
import asyncio
import hashlib
import tempfile

from g4f.client import Client
from g4f.Provider import Gemini, OpenaiChat
from conversation import Conversation


from dotenv import load_dotenv
from database import get_db, SessionLocal
from schema import SavedQuestion, APIKeyHash
import json

from datetime import datetime, timedelta, UTC
load_dotenv()

initialized = False
client = Client(
    provider=OpenaiChat,
    media_provider=Gemini
)



def get_key_in_db(key, db):
    hashed_key = hashlib.sha256(key.encode()).hexdigest()
    data = db.query(APIKeyHash).filter(APIKeyHash.key_hash == hashed_key).first()

    return data


def get_chat(key, db):

    data = get_key_in_db(key, db)

    if data and data.chat_history:
        return Conversation(client, history=data.chat_history)
    
    return Conversation(client)

def save_history(key, db, conversation: Conversation):
    data = get_key_in_db(key, db)
    
    if data:
        data.chat_history = conversation.history_str()
        db.commit()


def generate_response_stream(prompt_text: str, key, db, files: list[bytes], model : str):

    data = get_key_in_db(key, db)
    if data:
        if datetime.utcnow() - data.lastUsed > timedelta(minutes=5):
            data.chat_history = None
            db.commit()
            print("Chat expired due to inactivity. Starting new chat.")

    conversation = get_chat(key, db)
    
    temp_files = []
    if files and len(files) > 0:
        if len(files) > 10: files = files[0:9]
        for file in files:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as temp_file:
                temp_file.write(file)
                temp_file_path = temp_file.name
                temp_files.append(temp_file_path)


    for chunk in conversation.prompt(prompt_text, files=temp_files):
        yield chunk.text_delta
    save_history(key, db, conversation)


    for temp_file in temp_files:
        if os.path.exists(temp_file):
            os.remove(temp_file)

        

def process_gemini_request_stream(contents, key):

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

    for chunk in generate_response_stream(prompt_text, key, SessionLocal(), files):
        # print(chunk, end="")
        chunk
