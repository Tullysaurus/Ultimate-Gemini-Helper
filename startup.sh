#!/bin/bash

# This script updates and runs the Ultimate Gemini Helper application on startup.

# --- IMPORTANT: CONFIGURE THIS ---
# Set the absolute path to your project directory on the Raspberry Pi.
# For example: /home/pi/Ultimate-Gemini-Helper
PROJECT_DIR="/home/tully/Ultimate-Gemini-Helper"
# ---------------------------------

# Navigate to the project directory. Exit if it doesn't exist.
cd "$PROJECT_DIR" || { echo "Error: Project directory '$PROJECT_DIR' not found. Exiting."; exit 1; }

echo "--- Running startup script for Ultimate Gemini Helper ---"
echo "Timestamp: $(date)"
echo "Current directory: $(pwd)"

# Pull the latest code from the main branch.
# This assumes your local database and .env file are in .gitignore (recommended).
echo "Pulling latest code from git..."
git pull

# (Optional) If you use a Python virtual environment, activate it.
# Make sure the path to your venv is correct.
if [ -f ".venv/bin/activate" ]; then
  echo "Activating virtual environment..."
  source .venv/bin/activate
fi

# (Optional) Install/update dependencies if requirements.txt has changed.
# It's good practice to do this after pulling new code.
if [ -f "requirements.txt" ]; then
  echo "Installing/updating Python dependencies..."
  pip install -r requirements.txt
fi

# Run the main application using python3.
# The server will run in the foreground, which is what systemd expects.
echo "Starting the FastAPI server..."
python main.py