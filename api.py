import os
import hashlib
from datetime import datetime
from fastapi import FastAPI, HTTPException, Query, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from dotenv import load_dotenv
from sqlalchemy.orm import Session
from database import get_db
from schema import Question, SavedQuestion
from ai import process_gemini_request


load_dotenv()

# 2. Your Custom API Key (Front-end)
# Matches the `apiKey` variable in your JS
VALID_API_KEY = os.getenv("VALID_API_KEY")

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

# --- Endpoints ---

@app.post("/ai")
async def generate_content(
    request: GenerateContentRequest, 
    key: str = Query(..., description="The API Key"), # catches ?key=... from JS
    db: Session = Depends(get_db)
):
    # 1. Validate API Key
    if key != VALID_API_KEY:
        raise HTTPException(status_code=400, detail="Invalid API Key")

    try:
        # Process request
        response = await process_gemini_request(request.contents)

        # Save to DB (Overwrite)
        prompt_text, prompt_hash = get_prompt_hash(request.contents)
        saved_q = db.query(SavedQuestion).filter(SavedQuestion.prompt_hash == prompt_hash).first()
        
        if saved_q:
            saved_q.response = response
            saved_q.created_at = datetime.utcnow()
        else:
            saved_q = SavedQuestion(prompt_hash=prompt_hash, prompt=prompt_text, response=response)
            db.add(saved_q)
        db.commit()

        return response

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
