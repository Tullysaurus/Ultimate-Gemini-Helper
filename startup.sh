#!/bin/bash

# This script updates and runs the Ultimate Gemini Helper application on startup.

PROJECT_DIR=$(dirname -- "$(readlink -f "$0")")
# ---------------------------------

# Navigate to the project directory. Exit if it doesn't exist.
cd "$PROJECT_DIR" || { echo "Error: Project directory '$PROJECT_DIR' not found. Exiting."; exit 1; }

echo "--- Running startup script for Ultimate Gemini Helper ---"
echo "Timestamp: $(date)"
echo "Current directory: $(pwd)"

echo "Activating virtual environment..."
if [ -f ".venv/bin/activate" ]; then
  source .venv/bin/activate
fi

if [ -f ".env" ]; then
  echo "Loading environment variables from .env file..."
  source .env
fi

if [[ "$1" == "--refresh" ]]; then
  echo "Pulling latest code from git..."
  git pull

  if [ -f "requirements.txt" ]; then
    echo "Installing/updating Python dependencies..."
    pip install -r requirements.txt
  fi

  if [ -f "/etc/systemd/system/cloudflared.service" ]; then
    echo "Deleting cloudflared service"
    sudo systemctl stop cloudflared
    sudo systemctl disable cloudflared
    sudo cloudflared service uninstall
  fi

  echo "Enabling cloudflared service"
  sudo cloudflared service install "$TUNNEL_TOKEN"

  sudo systemctl daemon-reload
  sudo systemctl enable cloudflared
  sudo systemctl start cloudflared
fi


# Run the main application using python3.
# The server will run in the foreground, which is what systemd expects.
echo "Starting the FastAPI server..."
python main.py