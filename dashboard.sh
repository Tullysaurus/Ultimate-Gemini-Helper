#!/bin/bash

SESSION="pi-dashboard"
CONTAINER_NAME="gemini-api" # Matches the name in our compose file

# If already running, just attach
tmux has-session -t $SESSION 2>/dev/null
if [ $? -eq 0 ]; then
    tmux attach -t $SESSION
    exit
fi

# Start base session
tmux new-session -d -s $SESSION

# Split vertically for logs (bottom section)
tmux split-window -v -p 60 -t $SESSION

# ----- TOP SECTION -----

# Select top pane
tmux select-pane -t $SESSION:0.0

# Split top pane horizontally
tmux split-window -h -p 70 -t $SESSION:0.0

# Top-Left pane: fastfetch refreshing
tmux send-keys -t $SESSION:0.0 \
'while true; do clear; fastfetch; sleep 10; done' C-m

# Top-Right pane: btop
tmux send-keys -t $SESSION:0.1 "btop" C-m

# ----- BOTTOM SECTION (The Logs) -----

# We use docker logs -f to follow, and piping to ccze for color
# Note: ccze might need the -R flag for certain terminal emulators
tmux send-keys -t $SESSION:0.2 \
"docker logs -f $CONTAINER_NAME 2>&1 | stdbuf -oL ccze -A" C-m

# Final layout polish
tmux select-pane -t $SESSION:0.2
tmux attach -t $SESSION