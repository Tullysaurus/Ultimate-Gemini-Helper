#!/bin/bash

# This script updates and runs the Ultimate Gemini Helper application on startup.

# --- IMPORTANT: CONFIGURE THIS ---
# Set the absolute path to your project directory on the Raspberry Pi.
# For example: /home/pi/Ultimate-Gemini-Helper
PROJECT_DIR=$(dirname -- "$(readlink -f "$0")")
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
echo "Activating virtual environment..."
if [ -f ".venv/bin/activate" ]; then
  python -m venv .venv
fi
source .venv/bin/activate


# (Optional) Install/update dependencies if requirements.txt has changed.
# It's good practice to do this after pulling new code.
if [ -f "requirements.txt" ]; then
  echo "Installing/updating Python dependencies..."
  pip install -r requirements.txt
fi

source .env
cloudflared tunnel run --token $TUNNEL_TOKEN &

# Run the main application using python3.
# The server will run in the foreground, which is what systemd expects.
echo "Starting the FastAPI server..."
python main.py
