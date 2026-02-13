import os
import base64
import asyncio
import tempfile
from gemini_webapi import GeminiClient
from gemini_webapi.constants import Model
from dotenv import load_dotenv
from fastapi import HTTPException

load_dotenv()

default_model = Model.G_3_0_FLASH

SECURE_1PSID = os.getenv("SECURE_1PSID")
SECURE_1PSIDTS = os.getenv("SECURE_1PSIDTS")

if not SECURE_1PSID or not SECURE_1PSIDTS:
    raise HTTPException(status_code=500, detail="Server Error: Missing Gemini Cookies in environment variables.")

client = GeminiClient(SECURE_1PSID, SECURE_1PSIDTS)
asyncio.run(client.init(timeout=30, auto_close=False, auto_refresh=True))

async def generate_response_stream(prompt_text: str, image_data: bytes = None, model : str=default_model):

    if image_data:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as temp_file:
            temp_file.write(image_data)
            temp_file_path = temp_file.name
        try:
            async for chunk in client.generate_content_stream(prompt_text, files=[temp_file_path]):
                yield chunk.text_delta
        except Exception as e:
            print(f"Warning: Image generation failed ({e}). Falling back to text-only.")
            async for chunk in client.generate_content_stream(prompt_text):
                yield chunk.text_delta
        finally:
            if os.path.exists(temp_file_path):
                os.remove(temp_file_path)
    else:
        async for chunk in client.generate_content_stream(prompt_text):
            print(chunk.text_delta)
            yield chunk.text_delta

async def process_gemini_request_stream(contents, model=default_model):
    prompt_text = ""
    image_data = None    
    
    for content in contents:
        for part in content.parts:
            # Handle Text
            if part.text:
                prompt_text += part.text + "\n"
            
            # Handle Image (Base64)
            if part.inline_data:
                try:
                    image_data = base64.b64decode(part.inline_data.data)
                except Exception:
                    print("Failed to decode base64 image")

    async for chunk in generate_response_stream(prompt_text, image_data, model):
        yield chunk