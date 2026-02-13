import os
import hashlib
from datetime import datetime
from fastapi import FastAPI, HTTPException, Query, Request, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from dotenv import load_dotenv
from sqlalchemy.orm import Session
from database import get_db, SessionLocal
from schema import Question, SavedQuestion, APIKeyHash
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

class QuestionQuery(BaseModel):
    questionId: str
    questionType: Optional[str] = None
    answerIds: Optional[List[str]] = None

class AnswerSubmission(BaseModel):
    questionId: str
    correctAnswers: Any
    answerType: Optional[str] = None

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
    db = SessionLocal()
    try:
        save_question_to_db(db, prompt_hash, prompt_text, response)
    finally:
        db.close()

# --- Endpoints ---


@app.post("/ai")
async def generate_content(
    request: GenerateContentRequest, 
    background_tasks: BackgroundTasks,
    key: str = Query(..., description="The API Key"), # catches ?key=... from JS
    db: Session = Depends(get_db)
):
    # 1. Validate API Key
    hashed_key = hashlib.sha256(key.encode()).hexdigest()
    if not db.query(APIKeyHash).filter(APIKeyHash.key_hash == hashed_key).first():
        raise HTTPException(status_code=400, detail="Invalid API Key")

    async def stream_generator():
        full_response_text = ""
        try:
            async for chunk in process_gemini_request_stream(request.contents):
                full_response_text += chunk
                yield chunk
            
            # Save to DB (Overwrite)
            prompt_text, prompt_hash = get_prompt_hash(request.contents)
            
            # Construct response object similar to non-streaming
            response_data = {
                "candidates": [
                    {
                        "content": {
                            "parts": [{"text": full_response_text}],
                            "role": "model"
                        },
                        "finishReason": "STOP",
                        "index": 0,
                        "safetyRatings": []
                    }
                ]
            }
            background_tasks.add_task(save_question_background, prompt_hash, prompt_text, response_data)

        except Exception as e:
            print(f"Stream Error: {e}")
            yield f"[ERROR: {str(e)}]"

    return StreamingResponse(stream_generator(), media_type="text/plain")

@app.post("/ask")
async def ask_cached(
    request: GenerateContentRequest,
    background_tasks: BackgroundTasks,
    key: str = Query(..., description="The API Key"),
    db: Session = Depends(get_db)
):
    hashed_key = hashlib.sha256(key.encode()).hexdigest()

    if not db.query(APIKeyHash).filter(APIKeyHash.key_hash == hashed_key).first():
        raise HTTPException(status_code=400, detail="Invalid API Key")

    async def stream_generator():
        prompt_text, prompt_hash = get_prompt_hash(request.contents)
        
        # Check DB
        saved_q = db.query(SavedQuestion).filter(SavedQuestion.prompt_hash == prompt_hash).first()
        
        if saved_q:
            try:
                print("Using cached response")
                text = saved_q.response["candidates"][0]["content"]["parts"][0]["text"]
                yield text
            except Exception:
                yield ""
            return

        # Not cached
        full_response_text = ""
        try:
            async for chunk in process_gemini_request_stream(request.contents):
                full_response_text += chunk
                print(chunk, end="")
                yield chunk
            
            response_data = {
                "candidates": [
                    {
                        "content": {
                            "parts": [{"text": full_response_text}],
                            "role": "model"
                        },
                        "finishReason": "STOP",
                        "index": 0,
                        "safetyRatings": []
                    }
                ]
            }
            
            background_tasks.add_task(save_question_background, prompt_hash, prompt_text, response_data)

        except Exception as e:
            print(f"Stream Error: {e}")
            yield f"[ERROR: {str(e)}]"

    return StreamingResponse(stream_generator(), media_type="text/plain")
