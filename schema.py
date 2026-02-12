from sqlalchemy import Column, String, JSON, DateTime, Text
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime, timedelta

Base = declarative_base()

class Question(Base):
    __tablename__ = "questions"

    question_id = Column(String, primary_key=True, index=True)
    correct_answers = Column(JSON)
    answer_type = Column(String, nullable=True)

class SavedQuestion(Base):
    __tablename__ = "saved_questions"

    prompt_hash = Column(String, primary_key=True, index=True)
    prompt = Column(Text)
    response = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow)

    def is_expired(self):
        return datetime.utcnow() > self.created_at + timedelta(days=30)

class APIKeyHash(Base):
    __tablename__ = "api_key_hashes"
    key_hash = Column(String, primary_key=True)
