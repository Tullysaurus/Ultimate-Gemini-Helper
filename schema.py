from sqlalchemy import Column, String, JSON, DateTime, Text, Boolean, Integer
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime

Base = declarative_base()

class SavedQuestion(Base):
    __tablename__ = "saved_questions"

    prompt_hash = Column(String, primary_key=True, index=True)
    prompt = Column(Text)
    response = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow)

class APIKeyHash(Base):
    __tablename__ = "api_key_hashes"
    key_hash = Column(String, primary_key=True)
    
    unlimited = Column(Boolean, default=False)
    
    usesLeft = Column(Integer, default=0)

    lastUsed = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)

