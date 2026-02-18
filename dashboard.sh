#!/bin/bash

SESSION="ugh-dashboard"
CONTAINER_NAME="gemini-api"
HTOP_CONF="$HOME/.config/htop/ugh_dashboard_htoprc"

# Create the htop directory if it doesn't exist
mkdir -p "$(dirname "$HTOP_CONF")"

# If already running, just attach
tmux has-session -t $SESSION 2>/dev/null
if [ $? -eq 0 ]; then
    tmux attach -t $SESSION
    exit
fi

# Start base session
tmux new-session -d -s $SESSION

# Split vertically: Top = System, Bottom = Logs
tmux split-window -v -p 50 -t $SESSION

# ----- TOP SECTION (Custom htop) -----
# We point htop to your custom config file
tmux send-keys -t $SESSION:0.0 "HTOPRC=$HTOP_CONF htop" C-m

# ----- BOTTOM SECTION (Log Highlight) -----
# We use stdbuf to prevent log buffering and force docker to keep colors
tmux send-keys -t $SESSION:0.1 \
"docker logs -f --tail 50 $CONTAINER_NAME 2>&1" C-m

# Final layout polish
tmux select-pane -t $SESSION:0.1
tmux attach -t $SESSION
