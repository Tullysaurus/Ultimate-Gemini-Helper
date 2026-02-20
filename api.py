import os
import hashlib
from datetime import datetime, UTC
from fastapi import FastAPI, HTTPException, Query, Request, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from dotenv import load_dotenv
from sqlalchemy.orm import Session
from database import get_db, SessionLocal
from schema import SavedQuestion, APIKeyHash
from ai import process_gemini_request_stream


load_dotenv()

app = FastAPI(title="Gemini API Mirror")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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

class AnswerSubmission(BaseModel):
    prompt: str
    answers: Any

# --- Helpers ---

def get_prompt_hash(contents: List[Content]) -> tuple[str, str]:
    prompt_text = ""
    for content in contents:
        for part in content.parts:
            if part.text:
                prompt_text += part.text + "\n"
    
    prompt_text = prompt_text.strip()
    return prompt_text, hashlib.sha256(prompt_text.encode()).hexdigest()

def save_question_to_db(db, prompt_hash, prompt_text, response):
    saved_q = db.query(SavedQuestion).filter(SavedQuestion.prompt_hash == prompt_hash).first()
    if saved_q:
        saved_q.response = response
        saved_q.created_at = datetime.utcnow()
    else:
        saved_q = SavedQuestion(prompt_hash=prompt_hash, prompt=prompt_text, response=response)
        db.add(saved_q)
    db.commit()

def save_question_background(prompt_hash, prompt_text, response):
    # disable saving questions for now
    # return

    db = SessionLocal()
    try:
        save_question_to_db(db, prompt_hash, prompt_text, response)
    finally:
        db.close()



def validateApiKey(db: Session, key: str):
    hashed_key = hashlib.sha256(key.encode()).hexdigest()
    data = db.query(APIKeyHash).filter(APIKeyHash.key_hash == hashed_key).first()

    if not data:
        return False
    
    data.lastUsed = datetime.now(UTC)

    if data.unlimited:
        db.commit()

        return True
    
    if data.usesLeft > 0:
        data.usesLeft -= 1
        db.commit()

        return True
    
    return False



# --- Endpoints ---


@app.post("/ai")
def generate_content(
    request: GenerateContentRequest, 
    background_tasks: BackgroundTasks,
    key: str = Query(..., description="The API Key"), # catches ?key=... from JS
    db: Session = Depends(get_db)
):
    # 1. Validate API Key
    
    if not validateApiKey(db, key):
        raise HTTPException(status_code=400, detail="Invalid API Key")

    def stream_generator():
        full_response_text = ""
        try:
            for chunk in process_gemini_request_stream(request.contents, key):
                full_response_text += chunk
                # print(chunk, end="")
                yield chunk
            
            # Save to DB (Overwrite)
            prompt_text, prompt_hash = get_prompt_hash(request.contents)
            
            background_tasks.add_task(save_question_background, prompt_hash, prompt_text, full_response_text)

        except Exception as e:
            print(f"Stream Error: {e}")
            yield f"[ERROR: {str(e)}]"

    return StreamingResponse(stream_generator(), media_type="text/plain")

@app.post("/ask")
def ask_cached(
    request: GenerateContentRequest,
    background_tasks: BackgroundTasks,
    key: str = Query(..., description="The API Key"),
    db: Session = Depends(get_db)
):
    
    if not validateApiKey(db, key):
        raise HTTPException(status_code=400, detail="Invalid API Key")

    def stream_generator():
        prompt_text, prompt_hash = get_prompt_hash(request.contents)
        
        # Check DB
        saved_q = db.query(SavedQuestion).filter(SavedQuestion.prompt_hash == prompt_hash).first()
        
        if saved_q:
            try:
                print("Using cached response")
                text = saved_q.response
                yield text
            except Exception:
                yield ""
            return

        # Not cached
        full_response_text = ""
        try:
            for chunk in process_gemini_request_stream(request.contents, key):
                full_response_text += chunk
                # print(chunk, end="")
                yield chunk
            
            background_tasks.add_task(save_question_background, prompt_hash, prompt_text, full_response_text)

        except Exception as e:
            print(f"Stream Error: {e}")
            yield f"[ERROR: {str(e)}]"

    return StreamingResponse(stream_generator(), media_type="text/plain")

@app.post("/answers")
async def save_answers(
    request: AnswerSubmission,
    background_tasks: BackgroundTasks,
    key: str = Query(..., description="The API Key"),
    db: Session = Depends(get_db)
):  
    if not validateApiKey(db, key):
        raise HTTPException(status_code=400, detail="Invalid API Key")

    prompt_hash = hashlib.sha256(request.prompt.encode()).hexdigest()
    response = " || ".join(request.answers)

    save_question_to_db(db, prompt_hash, request.prompt, response)
    
    return {"status": "success", "message": "Answers received"}

@app.get("/answers")
async def get_answers(
    prompt: str = Query(..., description="The prompt text to retrieve answers for"),
    key: str = Query(..., description="The API Key"),
    db: Session = Depends(get_db)
):
    if not validateApiKey(db, key):
        raise HTTPException(status_code=400, detail="Invalid API Key")

    prompt_hash = hashlib.sha256(prompt.encode()).hexdigest()
    saved_q = db.query(SavedQuestion).filter(SavedQuestion.prompt_hash == prompt_hash).first()

    if not saved_q:
        raise HTTPException(status_code=404, detail="No answers found for the given prompt")

    return {"prompt": saved_q.prompt, "answers": saved_q.response}