FROM python:3.12-slim

WORKDIR /app

# Install system dependencies (needed for SQLite/SQLAlchemy)
RUN apt-get update && apt-get install -y \
    sqlite3 \
    build-essentials \
    gcc \  
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Run as a non-privileged user for security
RUN useradd -m john
USER john

# Use --proxy-headers so FastAPI knows it's behind a tunnel
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]